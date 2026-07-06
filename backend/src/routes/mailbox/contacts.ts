import { Router, type Request, type Response } from 'express';
import { getUserId } from '../../auth/middleware.js';
import { Mailbox } from '../../models/Mailbox.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { getRedisClient } from '../../config/redis.js';
import { graphFetch, graphFetchAllPages } from '../../services/graphClient.js';
import logger from '../../config/logger.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';

const contactsRouter = Router();

// ---- Contact folder & search endpoints ----

/**
 * GET /api/mailboxes/:id/contact-folders
 *
 * Returns all contact folders for a mailbox with contact counts.
 */
contactsRouter.get('/:id/contact-folders', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: getUserId(req),
  });

  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());

  interface ContactFolderResult {
    id: string;
    displayName: string;
    totalCount: number;
  }
  const folders: ContactFolderResult[] = [];

  // 1. Always include the default "Contacts" folder (not returned by /contactFolders)
  //    Use special id "default" — the contacts search endpoint handles this.
  try {
    const defaultCountRes = await graphFetch(
      `/users/${mailbox.email}/contacts/$count`,
      accessToken,
      { headers: { 'ConsistencyLevel': 'eventual' } },
    );
    const defaultCountText = await defaultCountRes.text();
    folders.push({
      id: 'default',
      displayName: 'Contacts',
      totalCount: parseInt(defaultCountText, 10) || 0,
    });
  } catch {
    // If count fails, still add with 0
    folders.push({ id: 'default', displayName: 'Contacts', totalCount: 0 });
  }

  // 2. List user-created sub-folders under the default contacts folder
  const subFolderResults = await graphFetchAllPages<
    { id: string; displayName: string },
    ContactFolderResult
  >(
    `/users/${mailbox.email}/contactFolders?$top=100&$select=id,displayName`,
    accessToken,
    undefined,
    (folder) => ({ id: folder.id, displayName: folder.displayName, totalCount: 0 }),
  );
  folders.push(...subFolderResults);

  // Fetch contact counts for sub-folders in parallel
  const subFolders = folders.filter((f) => f.id !== 'default');
  const countResults = await Promise.allSettled(
    subFolders.map(async (folder) => {
      const countRes = await graphFetch(
        `/users/${mailbox.email}/contactFolders/${folder.id}/contacts/$count`,
        accessToken,
        { headers: { 'ConsistencyLevel': 'eventual' } },
      );
      const text = await countRes.text();
      return { id: folder.id, count: parseInt(text, 10) || 0 };
    }),
  );

  for (const result of countResults) {
    if (result.status === 'fulfilled') {
      const folder = folders.find((f) => f.id === result.value.id);
      if (folder) folder.totalCount = result.value.count;
    }
  }

  res.json({ folders });
});

/**
 * GET /api/mailboxes/:id/contacts
 *
 * Search contacts in a specific contact folder.
 * Query params:
 *   - folderId: contact folder ID (required)
 *   - q: search query (optional, searches all fields)
 *   - all: if "true", serves from Redis cache (instant). On cache miss, fetches
 *          first page from Graph and queues a background full-sync.
 *   - refresh: if "true" with all=true, forces a full Graph API fetch + cache rebuild
 */
contactsRouter.get('/:id/contacts', async (req: Request, res: Response) => {
  const { folderId, q, all, refresh } = req.query as {
    folderId?: string; q?: string; all?: string; refresh?: string;
  };

  if (!folderId) {
    throw new ValidationError('folderId query parameter is required');
  }

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: getUserId(req),
  });

  if (!mailbox) {
    throw new NotFoundError('Mailbox not found');
  }

  const fetchAll = all === 'true';
  const forceRefresh = refresh === 'true';
  const redis = getRedisClient();
  const cacheKey = `contacts:${mailbox._id.toString()}:all`;
  const metaKey = `contacts:${mailbox._id.toString()}:meta`;

  // --- Fast path: serve from Redis cache when all=true ---
  if (fetchAll && !forceRefresh) {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const metaRaw = await redis.get(metaKey);
      const meta = metaRaw ? JSON.parse(metaRaw) : {};
      const contacts = JSON.parse(cached);
      contacts.sort((a: { displayName: string }, b: { displayName: string }) =>
        (!a.displayName ? 1 : 0) - (!b.displayName ? 1 : 0) || (a.displayName || '').localeCompare(b.displayName || ''),
      );
      res.json({ contacts, cached: true, syncedAt: meta.syncedAt || null });
      return;
    }
  }

  // --- Cache miss or refresh: fetch from Graph API ---
  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const selectFields = 'id,displayName,emailAddresses,companyName,department,jobTitle,businessPhones,mobilePhone,personalNotes';

  const basePath = folderId === 'default'
    ? `/users/${mailbox.email}/contacts`
    : `/users/${mailbox.email}/contactFolders/${folderId}/contacts`;

  interface RawContact {
    id: string;
    displayName?: string;
    emailAddresses?: Array<{ name?: string; address?: string }>;
    companyName?: string;
    department?: string;
    jobTitle?: string;
    businessPhones?: string[];
    mobilePhone?: string;
    personalNotes?: string;
  }

  const mapContact = (c: RawContact) => ({
    id: c.id,
    displayName: c.displayName || '',
    emailAddresses: c.emailAddresses || [],
    companyName: c.companyName || '',
    department: c.department || '',
    jobTitle: c.jobTitle || '',
    businessPhones: c.businessPhones || [],
    mobilePhone: c.mobilePhone || '',
    personalNotes: c.personalNotes || '',
  });

  const pageSize = fetchAll ? 100 : 50;

  let graphUrl: string | undefined;
  if (q && q.trim()) {
    const searchTerm = q.trim().replace(/"/g, '\\"');
    graphUrl = `${basePath}?$search="${searchTerm}"&$select=${selectFields}&$top=${pageSize}&$orderby=displayName`;
  } else if (fetchAll) {
    // Skip $orderby for fetchAll — Graph sorts empty displayName first, making
    // the first page all blank names.  We sort locally after fetching anyway.
    graphUrl = `${basePath}?$select=${selectFields}&$top=${pageSize}`;
  } else {
    graphUrl = `${basePath}?$select=${selectFields}&$top=${pageSize}&$orderby=displayName`;
  }

  // Fetch first page
  const firstPageResp = await graphFetch(graphUrl!, accessToken, {
    headers: { 'ConsistencyLevel': 'eventual' },
  });
  const firstPageData = (await firstPageResp.json()) as {
    value: RawContact[];
    '@odata.nextLink'?: string;
  };

  const firstPageContacts = (firstPageData.value || []).map(mapContact);
  const nextLink = fetchAll ? firstPageData['@odata.nextLink'] : undefined;

  // For fetchAll with remaining pages: return first page now, fetch rest in background
  if (fetchAll && nextLink) {
    firstPageContacts.sort((a, b) => (!a.displayName ? 1 : 0) - (!b.displayName ? 1 : 0) || (a.displayName || '').localeCompare(b.displayName || ''));
    // Mark as partial — a background job is populating the cache
    redis.set(`contacts:${mailbox._id.toString()}:loading`, '1', 'EX', 120).catch(() => {});
    res.json({ contacts: firstPageContacts, cached: false, syncedAt: null, partial: true });

    // Background: fetch remaining pages and populate cache
    (async () => {
      try {
        const restContacts = await graphFetchAllPages(nextLink, accessToken, {
          headers: { 'ConsistencyLevel': 'eventual' },
        }, mapContact);
        const allContacts = [...firstPageContacts, ...restContacts];
        allContacts.sort((a, b) => (!a.displayName ? 1 : 0) - (!b.displayName ? 1 : 0) || (a.displayName || '').localeCompare(b.displayName || ''));
        const now = new Date().toISOString();
        await redis.set(cacheKey, JSON.stringify(allContacts), 'EX', 86400);
        await redis.set(metaKey, JSON.stringify({ count: allContacts.length, syncedAt: now }), 'EX', 86400);
        await redis.del(`contacts:${mailbox._id.toString()}:loading`);
      } catch (err) {
        logger.error('Background contacts fetch failed', { error: (err as Error).message });
        await redis.del(`contacts:${mailbox._id.toString()}:loading`).catch(() => {});
      }
    })();
    return;
  }

  // No more pages — we have everything in firstPageContacts
  if (!fetchAll) {
    res.json({ contacts: firstPageContacts });
    return;
  }

  // fetchAll with no nextLink — all fit in one page
  firstPageContacts.sort((a, b) => (!a.displayName ? 1 : 0) - (!b.displayName ? 1 : 0) || (a.displayName || '').localeCompare(b.displayName || ''));
  const now = new Date().toISOString();
  redis.set(cacheKey, JSON.stringify(firstPageContacts), 'EX', 86400).catch(() => {});
  redis.set(metaKey, JSON.stringify({ count: firstPageContacts.length, syncedAt: now }), 'EX', 86400).catch(() => {});
  res.json({ contacts: firstPageContacts, cached: false, syncedAt: now });
});

// ---- Contact CRUD endpoints ----
// NOTE: bulk-delete and import MUST be declared before /:id/contacts/:contactId
// to avoid ':contactId' capturing 'bulk-delete' / 'import'.

/**
 * POST /api/mailboxes/:id/contacts/bulk-delete
 *
 * Delete multiple contacts at once.
 * Body: { contactIds: string[] }
 */
contactsRouter.post('/:id/contacts/bulk-delete', async (req: Request, res: Response) => {
  const { contactIds } = req.body as { contactIds?: string[] };

  if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
    throw new ValidationError('contactIds is required and must be a non-empty array');
  }

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: getUserId(req),
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  let deleted = 0;
  let failed = 0;

  // Delete in parallel batches of 10
  for (let i = 0; i < contactIds.length; i += 10) {
    const batch = contactIds.slice(i, i + 10);
    const results = await Promise.allSettled(
      batch.map((cid) =>
        graphFetch(`/users/${mailbox.email}/contacts/${cid}`, accessToken, {
          method: 'DELETE',
        }),
      ),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') deleted++;
      else failed++;
    }
  }

  logger.info('Bulk deleted contacts', { mailboxId: req.params.id, deleted, failed, total: contactIds.length });
  res.json({ deleted, failed, total: contactIds.length });
});

/**
 * POST /api/mailboxes/:id/contacts/import
 *
 * Import contacts into a contact folder.
 * Body: { folderId: string, contacts: ImportContact[] }
 */
contactsRouter.post('/:id/contacts/import', async (req: Request, res: Response) => {
  const { folderId, contacts: importContacts } = req.body as {
    folderId?: string;
    contacts?: Array<{
      displayName: string;
      emailAddresses?: Array<{ address: string; name?: string }>;
      companyName?: string;
      department?: string;
      jobTitle?: string;
      businessPhones?: string[];
      mobilePhone?: string;
    }>;
  };

  if (!folderId) throw new ValidationError('folderId is required');
  if (!importContacts || !Array.isArray(importContacts) || importContacts.length === 0) {
    throw new ValidationError('contacts is required and must be a non-empty array');
  }

  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: getUserId(req),
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const basePath = folderId === 'default'
    ? `/users/${mailbox.email}/contacts`
    : `/users/${mailbox.email}/contactFolders/${folderId}/contacts`;

  let created = 0;
  let failed = 0;

  // Create in parallel batches of 5
  for (let i = 0; i < importContacts.length; i += 5) {
    const batch = importContacts.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map((contact) =>
        graphFetch(basePath, accessToken, {
          method: 'POST',
          body: JSON.stringify({
            displayName: contact.displayName,
            emailAddresses: contact.emailAddresses || [],
            companyName: contact.companyName || null,
            department: contact.department || null,
            jobTitle: contact.jobTitle || null,
            businessPhones: contact.businessPhones || [],
            mobilePhone: contact.mobilePhone || null,
          }),
        }),
      ),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') created++;
      else failed++;
    }
  }

  logger.info('Imported contacts', { mailboxId: req.params.id, created, failed, total: importContacts.length });
  res.json({ created, failed, total: importContacts.length });
});

/**
 * DELETE /api/mailboxes/:id/contacts/:contactId
 *
 * Delete a single contact.
 */
contactsRouter.delete('/:id/contacts/:contactId', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: getUserId(req),
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  await graphFetch(`/users/${mailbox.email}/contacts/${req.params.contactId}`, accessToken, {
    method: 'DELETE',
  });

  res.json({ success: true });
});

/**
 * PATCH /api/mailboxes/:id/contacts/:contactId
 *
 * Update a single contact.
 * Body: partial contact fields { displayName?, emailAddresses?, companyName?, department?, jobTitle?, businessPhones?, mobilePhone? }
 */
contactsRouter.patch('/:id/contacts/:contactId', async (req: Request, res: Response) => {
  const mailbox = await Mailbox.findOne({
    _id: req.params.id,
    userId: getUserId(req),
  });
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const accessToken = await getAccessTokenForMailbox(mailbox._id.toString());
  const allowedFields = ['displayName', 'emailAddresses', 'companyName', 'department', 'jobTitle', 'businessPhones', 'mobilePhone', 'personalNotes'];
  const updateData: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  const response = await graphFetch(
    `/users/${mailbox.email}/contacts/${req.params.contactId}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify(updateData),
    },
  );
  const updated = await response.json();

  res.json({ contact: updated });
});

export default contactsRouter;
