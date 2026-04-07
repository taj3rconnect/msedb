import { graphFetch, GraphApiError } from './graphClient.js';
import { getAccessTokenForMailbox } from '../auth/tokenManager.js';
import { CalendarSyncMap } from '../models/CalendarSyncMap.js';
import { Mailbox } from '../models/Mailbox.js';
import logger from '../config/logger.js';

interface GraphCalendarEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string };
  body?: { contentType: string; content: string };
  isAllDay: boolean;
  showAs?: string;
  sensitivity?: string;
  isCancelled?: boolean;
  isOrganizer?: boolean;
  recurrence?: unknown;
  onlineMeetingUrl?: string;
}

const EVENT_SELECT =
  'id,subject,start,end,location,body,isAllDay,showAs,sensitivity,isCancelled,isOrganizer,recurrence,onlineMeetingUrl';

/**
 * Fetch a single calendar event from Graph API.
 */
async function fetchCalendarEvent(
  mailboxId: string,
  eventId: string
): Promise<GraphCalendarEvent | null> {
  try {
    const accessToken = await getAccessTokenForMailbox(mailboxId);
    const mailbox = await Mailbox.findById(mailboxId).select('email');
    if (!mailbox) return null;

    const res = await graphFetch(
      `/users/${encodeURIComponent(mailbox.email)}/events/${encodeURIComponent(eventId)}?$select=${EVENT_SELECT}`,
      accessToken
    );
    return (await res.json()) as GraphCalendarEvent;
  } catch (err) {
    if (err instanceof GraphApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Create a calendar event in the target mailbox and return its new event ID.
 */
async function createMirrorEvent(
  targetMailboxId: string,
  event: GraphCalendarEvent
): Promise<string> {
  const accessToken = await getAccessTokenForMailbox(targetMailboxId);
  const mailbox = await Mailbox.findById(targetMailboxId).select('email');
  if (!mailbox) throw new Error(`Mailbox not found: ${targetMailboxId}`);

  const body: Record<string, unknown> = {
    subject: event.subject,
    start: event.start,
    end: event.end,
    isAllDay: event.isAllDay,
    showAs: event.showAs ?? 'busy',
    // Copy body content (contains Teams/Zoom links, notes, agenda)
    // Do NOT copy attendees — would send meeting invites to participants
    // Do NOT copy onlineMeeting object — would create a new Teams meeting
  };
  if (event.location?.displayName) body['location'] = event.location;
  if (event.body) body['body'] = event.body;
  if (event.recurrence) body['recurrence'] = event.recurrence;
  // Append meeting URL to body if present but not already in body content
  if (event.onlineMeetingUrl && (!event.body?.content?.includes(event.onlineMeetingUrl))) {
    const existing = (event.body?.content ?? '');
    body['body'] = {
      contentType: 'html',
      content: existing + `<br><a href="${event.onlineMeetingUrl}">Join Meeting</a>`,
    };
  }

  const res = await graphFetch(
    `/users/${encodeURIComponent(mailbox.email)}/events`,
    accessToken,
    { method: 'POST', body: JSON.stringify(body) }
  );
  const created = (await res.json()) as { id: string };
  return created.id;
}

/**
 * Update an existing mirror event in the target mailbox.
 */
async function updateMirrorEvent(
  targetMailboxId: string,
  targetEventId: string,
  event: GraphCalendarEvent
): Promise<void> {
  const accessToken = await getAccessTokenForMailbox(targetMailboxId);
  const mailbox = await Mailbox.findById(targetMailboxId).select('email');
  if (!mailbox) throw new Error(`Mailbox not found: ${targetMailboxId}`);

  const body: Record<string, unknown> = {
    subject: event.subject,
    start: event.start,
    end: event.end,
    isAllDay: event.isAllDay,
    showAs: event.showAs ?? 'busy',
  };
  if (event.location?.displayName) body['location'] = event.location;
  if (event.body) body['body'] = event.body;
  if (event.recurrence) body['recurrence'] = event.recurrence;
  if (event.onlineMeetingUrl && (!event.body?.content?.includes(event.onlineMeetingUrl))) {
    const existing = (event.body?.content ?? '');
    body['body'] = { contentType: 'html', content: existing + `<br><a href="${event.onlineMeetingUrl}">Join Meeting</a>` };
  }

  await graphFetch(
    `/users/${encodeURIComponent(mailbox.email)}/events/${encodeURIComponent(targetEventId)}`,
    accessToken,
    { method: 'PATCH', body: JSON.stringify(body) }
  );
}

/**
 * Delete a mirror event in the target mailbox.
 * Silently ignores 404 (already gone).
 */
async function deleteMirrorEvent(
  targetMailboxId: string,
  targetEventId: string
): Promise<void> {
  try {
    const accessToken = await getAccessTokenForMailbox(targetMailboxId);
    const mailbox = await Mailbox.findById(targetMailboxId).select('email');
    if (!mailbox) return;

    await graphFetch(
      `/users/${encodeURIComponent(mailbox.email)}/events/${encodeURIComponent(targetEventId)}`,
      accessToken,
      { method: 'DELETE' }
    );
  } catch (err) {
    if (err instanceof GraphApiError && err.status === 404) return;
    throw err;
  }
}

/**
 * Check if an event ID in a given mailbox is a known mirror (not a source).
 * Used for loop prevention: if true, do not sync this event again.
 */
async function isMirrorEvent(mailboxId: string, eventId: string): Promise<boolean> {
  const found = await CalendarSyncMap.findOne({
    'mirrors.mailboxId': mailboxId,
    'mirrors.eventId': eventId,
    isDeleted: false,
  }).lean();
  return found !== null;
}

/**
 * Handle a calendar event CREATED in sourceMailboxId.
 * Replicates the event to all other connected mailboxes for the same user.
 */
export async function syncEventCreate(
  sourceMailboxId: string,
  eventId: string
): Promise<void> {
  // Loop prevention: skip if this event is already a mirror of another source
  if (await isMirrorEvent(sourceMailboxId, eventId)) {
    logger.debug('Calendar sync: skipping mirror event (create)', { sourceMailboxId, eventId });
    return;
  }

  // Skip if already tracked as source (idempotent)
  const existing = await CalendarSyncMap.findOne({
    sourceMailboxId,
    sourceEventId: eventId,
  });
  if (existing) {
    logger.debug('Calendar sync: event already tracked, skipping create', { eventId });
    return;
  }

  const event = await fetchCalendarEvent(sourceMailboxId, eventId);
  if (!event) {
    logger.warn('Calendar sync: source event not found', { sourceMailboxId, eventId });
    return;
  }

  // Cancelled events don't need to be synced
  if (event.isCancelled) return;

  const sourceMailbox = await Mailbox.findById(sourceMailboxId).select('userId');
  if (!sourceMailbox) return;

  const userId = sourceMailbox.userId.toString();
  const allMailboxes = await Mailbox.find({ userId, isConnected: true }).select('_id');
  const others = allMailboxes.filter((m) => m._id.toString() !== sourceMailboxId);

  const mirrors: Array<{ mailboxId: unknown; eventId: string }> = [];

  for (const mailbox of others) {
    const targetId = mailbox._id.toString();
    try {
      const newEventId = await createMirrorEvent(targetId, event);
      mirrors.push({ mailboxId: mailbox._id, eventId: newEventId });
      logger.info('Calendar sync: mirror created', {
        sourceMailboxId,
        targetMailboxId: targetId,
        sourceEventId: eventId,
        mirrorEventId: newEventId,
      });
    } catch (err) {
      logger.error('Calendar sync: failed to create mirror', {
        sourceMailboxId,
        targetMailboxId: targetId,
        eventId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await CalendarSyncMap.create({
    userId,
    sourceMailboxId,
    sourceEventId: eventId,
    subject: event.subject || '',
    startDateTime: new Date(event.start.dateTime),
    endDateTime: new Date(event.end.dateTime),
    isAllDay: event.isAllDay,
    mirrors,
    lastSyncedAt: new Date(),
  });

  logger.info('Calendar sync: event synced to all accounts', {
    sourceMailboxId,
    eventId,
    mirrorCount: mirrors.length,
  });
}

/**
 * Handle a calendar event UPDATED in sourceMailboxId.
 * Updates all mirror copies.
 */
export async function syncEventUpdate(
  sourceMailboxId: string,
  eventId: string
): Promise<void> {
  // Check if this is a mirror being updated (loop prevention)
  const mirrorMap = await CalendarSyncMap.findOne({
    'mirrors.mailboxId': sourceMailboxId,
    'mirrors.eventId': eventId,
    isDeleted: false,
  });

  if (mirrorMap) {
    // This update came from a mirror — propagate the update back to the SOURCE
    // and to other mirrors, but only if the update originated from the mirror mailbox
    // (i.e., the user edited the mirror). We'll update the source and all other mirrors.
    const event = await fetchCalendarEvent(sourceMailboxId, eventId);
    if (!event || event.isCancelled) return;

    // Update the source event
    try {
      await updateMirrorEvent(
        mirrorMap.sourceMailboxId.toString(),
        mirrorMap.sourceEventId,
        event
      );
    } catch (err) {
      logger.error('Calendar sync: failed to update source from mirror edit', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Update other mirrors
    for (const mirror of mirrorMap.mirrors) {
      if (mirror.mailboxId.toString() === sourceMailboxId) continue;
      try {
        await updateMirrorEvent(mirror.mailboxId.toString(), mirror.eventId, event);
      } catch (err) {
        logger.error('Calendar sync: failed to update peer mirror', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Update metadata
    mirrorMap.subject = event.subject || '';
    mirrorMap.startDateTime = new Date(event.start.dateTime);
    mirrorMap.endDateTime = new Date(event.end.dateTime);
    mirrorMap.isAllDay = event.isAllDay;
    mirrorMap.lastSyncedAt = new Date();
    await mirrorMap.save();
    return;
  }

  // Check if this is a source event being updated
  const syncMap = await CalendarSyncMap.findOne({
    sourceMailboxId,
    sourceEventId: eventId,
    isDeleted: false,
  });

  if (!syncMap) {
    // Unknown event — treat as new
    await syncEventCreate(sourceMailboxId, eventId);
    return;
  }

  const event = await fetchCalendarEvent(sourceMailboxId, eventId);
  if (!event) return;

  if (event.isCancelled) {
    await syncEventDelete(sourceMailboxId, eventId);
    return;
  }

  for (const mirror of syncMap.mirrors) {
    try {
      await updateMirrorEvent(mirror.mailboxId.toString(), mirror.eventId, event);
    } catch (err) {
      logger.error('Calendar sync: failed to update mirror', {
        targetMailboxId: mirror.mailboxId.toString(),
        mirrorEventId: mirror.eventId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  syncMap.subject = event.subject || '';
  syncMap.startDateTime = new Date(event.start.dateTime);
  syncMap.endDateTime = new Date(event.end.dateTime);
  syncMap.isAllDay = event.isAllDay;
  syncMap.lastSyncedAt = new Date();
  await syncMap.save();

  logger.info('Calendar sync: event update propagated', {
    sourceMailboxId,
    eventId,
    mirrorCount: syncMap.mirrors.length,
  });
}

/**
 * Handle a calendar event DELETED in sourceMailboxId.
 * Deletes all mirror copies and marks the sync map as deleted.
 */
export async function syncEventDelete(
  sourceMailboxId: string,
  eventId: string
): Promise<void> {
  // Check if this is a mirror being deleted
  const mirrorMap = await CalendarSyncMap.findOne({
    'mirrors.mailboxId': sourceMailboxId,
    'mirrors.eventId': eventId,
    isDeleted: false,
  });

  if (mirrorMap) {
    // Mirror deleted — delete source and all other mirrors
    await deleteMirrorEvent(mirrorMap.sourceMailboxId.toString(), mirrorMap.sourceEventId);
    for (const mirror of mirrorMap.mirrors) {
      if (mirror.mailboxId.toString() === sourceMailboxId) continue;
      await deleteMirrorEvent(mirror.mailboxId.toString(), mirror.eventId);
    }
    mirrorMap.isDeleted = true;
    await mirrorMap.save();
    logger.info('Calendar sync: deleted from mirror, cascaded to source and peers', {
      sourceMailboxId,
      eventId,
    });
    return;
  }

  // Check if this is a source event being deleted
  const syncMap = await CalendarSyncMap.findOne({
    sourceMailboxId,
    sourceEventId: eventId,
    isDeleted: false,
  });

  if (!syncMap) return;

  for (const mirror of syncMap.mirrors) {
    try {
      await deleteMirrorEvent(mirror.mailboxId.toString(), mirror.eventId);
    } catch (err) {
      logger.error('Calendar sync: failed to delete mirror', {
        targetMailboxId: mirror.mailboxId.toString(),
        mirrorEventId: mirror.eventId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  syncMap.isDeleted = true;
  await syncMap.save();

  logger.info('Calendar sync: source deleted, all mirrors removed', {
    sourceMailboxId,
    eventId,
    mirrorCount: syncMap.mirrors.length,
  });
}

/**
 * Run a calendar delta sync for a single mailbox.
 * Fetches changes since the last delta link and processes creates/updates/deletes.
 */
export async function runCalendarDeltaSyncForMailbox(mailboxId: string): Promise<void> {
  const mailbox = await Mailbox.findById(mailboxId);
  if (!mailbox || !mailbox.isConnected) return;

  const accessToken = await getAccessTokenForMailbox(mailboxId);
  const deltaKey = 'calendar-events-delta';
  let deltaLink = mailbox.deltaLinks.get(deltaKey);

  // Note: Graph calendar delta does not support $select or $filter
  const url = deltaLink
    ? deltaLink
    : `/users/${encodeURIComponent(mailbox.email)}/events/delta`;

  let nextLink: string | undefined;
  let newDeltaLink: string | undefined;
  const events: Array<{ id: string; removed?: boolean }> = [];

  // Paginate through all delta results
  let currentUrl = url;
  while (currentUrl) {
    const res = await graphFetch(currentUrl, accessToken);
    const data = (await res.json()) as {
      value: Array<{ id: string; '@removed'?: { reason: string } }>;
      '@odata.nextLink'?: string;
      '@odata.deltaLink'?: string;
    };

    for (const item of data.value) {
      events.push({
        id: item.id,
        removed: !!item['@removed'],
      });
    }

    nextLink = data['@odata.nextLink'];
    newDeltaLink = data['@odata.deltaLink'];
    currentUrl = nextLink || '';
  }

  // Process each changed event
  for (const ev of events) {
    try {
      if (ev.removed) {
        await syncEventDelete(mailboxId, ev.id);
      } else if (deltaLink) {
        // We have a prior delta link, so these are changes (create or update)
        const isMirror = await isMirrorEvent(mailboxId, ev.id);
        if (!isMirror) {
          const existing = await CalendarSyncMap.findOne({
            sourceMailboxId: mailboxId,
            sourceEventId: ev.id,
            isDeleted: false,
          });
          if (existing) {
            await syncEventUpdate(mailboxId, ev.id);
          } else {
            await syncEventCreate(mailboxId, ev.id);
          }
        }
      }
      // On first run (no deltaLink), we don't back-fill all existing events
    } catch (err) {
      logger.error('Calendar delta sync: event processing failed', {
        mailboxId,
        eventId: ev.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Save the new delta link for next run
  if (newDeltaLink) {
    mailbox.deltaLinks.set(deltaKey, newDeltaLink);
    await mailbox.save();
  }

  logger.info('Calendar delta sync completed', {
    mailboxId,
    email: mailbox.email,
    eventsProcessed: events.length,
  });
}
