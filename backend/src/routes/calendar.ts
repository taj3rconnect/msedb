import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { CalendarSyncMap } from '../models/CalendarSyncMap.js';
import { Mailbox } from '../models/Mailbox.js';
import { syncEventDelete } from '../services/calendarSyncService.js';

const router = Router();
router.use(requireAuth);

/**
 * GET /api/calendar/events
 * Returns synced calendar events for the authenticated user.
 * Optional query params: limit (default 200), upcoming (bool, default true), startFrom (ISO date), startTo (ISO date)
 */
router.get('/events', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
  const startFrom = req.query.startFrom as string | undefined;
  const startTo = req.query.startTo as string | undefined;

  const filter: Record<string, unknown> = { userId, isDeleted: false };

  if (startFrom || startTo) {
    const range: Record<string, Date> = {};
    if (startFrom) range['$gte'] = new Date(startFrom);
    if (startTo) range['$lte'] = new Date(startTo);
    filter['startDateTime'] = range;
  } else {
    // Default: upcoming only
    filter['startDateTime'] = { $gte: new Date() };
  }

  const events = await CalendarSyncMap.find(filter)
    .sort({ startDateTime: 1 })
    .limit(limit)
    .lean();

  // Enrich with mailbox email info
  const mailboxIds = new Set<string>();
  for (const ev of events) {
    mailboxIds.add(ev.sourceMailboxId.toString());
    for (const m of ev.mirrors) mailboxIds.add(m.mailboxId.toString());
  }

  const mailboxes = await Mailbox.find({ _id: { $in: [...mailboxIds] } })
    .select('_id email displayName')
    .lean();

  const mailboxMap = Object.fromEntries(
    mailboxes.map((m) => [m._id.toString(), { email: m.email, displayName: m.displayName }])
  );

  const result = events.map((ev) => ({
    id: ev._id,
    subject: ev.subject,
    startDateTime: ev.startDateTime,
    endDateTime: ev.endDateTime,
    isAllDay: ev.isAllDay,
    sourceMailbox: mailboxMap[ev.sourceMailboxId.toString()] ?? null,
    mirrors: ev.mirrors.map((m) => ({
      mailbox: mailboxMap[m.mailboxId.toString()] ?? null,
      eventId: m.eventId,
    })),
    lastSyncedAt: ev.lastSyncedAt,
  }));

  res.json({ events: result });
});

/**
 * GET /api/calendar/sync-status
 * Returns per-mailbox sync status: how many events are synced, last sync time.
 */
router.get('/sync-status', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const mailboxes = await Mailbox.find({ userId, isConnected: true })
    .select('_id email displayName')
    .lean();

  const status = await Promise.all(
    mailboxes.map(async (mb) => {
      const mbId = mb._id.toString();

      const [asSource, asMirror, latest] = await Promise.all([
        CalendarSyncMap.countDocuments({ sourceMailboxId: mbId, isDeleted: false }),
        CalendarSyncMap.countDocuments({ 'mirrors.mailboxId': mbId, isDeleted: false }),
        CalendarSyncMap.findOne({
          $or: [{ sourceMailboxId: mbId }, { 'mirrors.mailboxId': mbId }],
          isDeleted: false,
        })
          .sort({ lastSyncedAt: -1 })
          .select('lastSyncedAt')
          .lean(),
      ]);

      return {
        mailboxId: mbId,
        email: mb.email,
        displayName: mb.displayName,
        eventsAsSource: asSource,
        eventsAsMirror: asMirror,
        totalSynced: asSource + asMirror,
        lastSyncedAt: latest?.lastSyncedAt ?? null,
      };
    })
  );

  res.json({ mailboxes: status });
});

/**
 * DELETE /api/calendar/events/:id
 * Cancel a synced event: deletes from Graph API (source + all mirrors) and soft-deletes the sync map entry.
 */
router.delete('/events/:id', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const syncMap = await CalendarSyncMap.findOne({ _id: id, userId, isDeleted: false });
  if (!syncMap) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  await syncEventDelete(syncMap.sourceMailboxId.toString(), syncMap.sourceEventId);

  res.json({ ok: true });
});

export const calendarRouter = router;
