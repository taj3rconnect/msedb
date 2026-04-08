import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getActivityCounts, findMailboxesByUser } from '../services/reportService.js';

const reportsRouter = Router();

reportsRouter.use(requireAuth);

/**
 * GET /api/reports/activity
 *
 * Query params: period (today|yesterday|thisWeek|lastWeek|thisMonth|lastMonth|ytd)
 *
 * Returns per-mailbox and total counts of rule-executed actions
 * categorized as deleted, movedAndRead, movedOnly, markedRead.
 */
reportsRouter.get('/activity', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const period = (req.query.period as string) || 'today';

  const { start, end } = getDateRange(period);

  const mailboxes = await findMailboxesByUser(userId);

  if (mailboxes.length === 0) {
    res.json({ mailboxes: [], totals: null, period, start, end });
    return;
  }

  const { mailboxes: mailboxCounts, totals } = await getActivityCounts(mailboxes, start, end);

  res.json({
    mailboxes: mailboxCounts,
    totals,
    period,
    start: start.toISOString(),
    end: end.toISOString(),
  });
});

/**
 * Calculate start/end dates for a given period name.
 * All calculations are in EST (America/New_York).
 */
function getDateRange(period: string): { start: Date; end: Date } {
  const nowUtc = new Date();
  const estOffset = getEstOffsetMs(nowUtc);
  const nowEstMs = nowUtc.getTime() + estOffset;

  const estNow = new Date(nowEstMs);
  const year = estNow.getUTCFullYear();
  const month = estNow.getUTCMonth();
  const day = estNow.getUTCDate();

  let startEst: Date;
  let endEst: Date;

  switch (period) {
    case 'today':
      startEst = new Date(Date.UTC(year, month, day, 0, 0, 0));
      endEst = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
      break;

    case 'yesterday': {
      const yDay = new Date(Date.UTC(year, month, day - 1));
      startEst = new Date(Date.UTC(yDay.getUTCFullYear(), yDay.getUTCMonth(), yDay.getUTCDate(), 0, 0, 0));
      endEst = new Date(Date.UTC(yDay.getUTCFullYear(), yDay.getUTCMonth(), yDay.getUTCDate(), 23, 59, 59, 999));
      break;
    }

    case 'thisWeek': {
      const dow = estNow.getUTCDay();
      const mondayOffset = dow === 0 ? 6 : dow - 1;
      const monday = new Date(Date.UTC(year, month, day - mondayOffset));
      startEst = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 0, 0, 0));
      endEst = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
      break;
    }

    case 'lastWeek': {
      const dow = estNow.getUTCDay();
      const mondayOffset = dow === 0 ? 6 : dow - 1;
      const thisMonday = new Date(Date.UTC(year, month, day - mondayOffset));
      const lastMonday = new Date(Date.UTC(thisMonday.getUTCFullYear(), thisMonday.getUTCMonth(), thisMonday.getUTCDate() - 7));
      const lastSunday = new Date(Date.UTC(thisMonday.getUTCFullYear(), thisMonday.getUTCMonth(), thisMonday.getUTCDate() - 1));
      startEst = new Date(Date.UTC(lastMonday.getUTCFullYear(), lastMonday.getUTCMonth(), lastMonday.getUTCDate(), 0, 0, 0));
      endEst = new Date(Date.UTC(lastSunday.getUTCFullYear(), lastSunday.getUTCMonth(), lastSunday.getUTCDate(), 23, 59, 59, 999));
      break;
    }

    case 'thisMonth':
      startEst = new Date(Date.UTC(year, month, 1, 0, 0, 0));
      endEst = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
      break;

    case 'lastMonth': {
      const lastM = new Date(Date.UTC(year, month - 1, 1));
      const lastMEnd = new Date(Date.UTC(year, month, 0));
      startEst = new Date(Date.UTC(lastM.getUTCFullYear(), lastM.getUTCMonth(), 1, 0, 0, 0));
      endEst = new Date(Date.UTC(lastMEnd.getUTCFullYear(), lastMEnd.getUTCMonth(), lastMEnd.getUTCDate(), 23, 59, 59, 999));
      break;
    }

    case 'ytd':
      startEst = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
      endEst = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
      break;

    default:
      startEst = new Date(Date.UTC(year, month, day, 0, 0, 0));
      endEst = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  }

  return {
    start: new Date(startEst.getTime() - estOffset),
    end: new Date(endEst.getTime() - estOffset),
  };
}

/**
 * Get EST/EDT offset in milliseconds for a given UTC date.
 * EST = UTC-5, EDT = UTC-4 (second Sunday in March to first Sunday in November).
 */
function getEstOffsetMs(utcDate: Date): number {
  const year = utcDate.getUTCFullYear();

  const marchFirst = new Date(Date.UTC(year, 2, 1));
  const marchFirstDay = marchFirst.getUTCDay();
  const secondSunday = marchFirstDay === 0 ? 8 : 15 - marchFirstDay;
  const dstStart = new Date(Date.UTC(year, 2, secondSunday, 7, 0, 0));

  const novFirst = new Date(Date.UTC(year, 10, 1));
  const novFirstDay = novFirst.getUTCDay();
  const firstSunday = novFirstDay === 0 ? 1 : 8 - novFirstDay;
  const dstEnd = new Date(Date.UTC(year, 10, firstSunday, 6, 0, 0));

  const isDst = utcDate >= dstStart && utcDate < dstEnd;
  return isDst ? -4 * 60 * 60 * 1000 : -5 * 60 * 60 * 1000;
}

export { reportsRouter };
