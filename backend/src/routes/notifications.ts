import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { Notification } from '../models/Notification.js';
import { NotFoundError } from '../middleware/errorHandler.js';

const notificationsRouter = Router();

// All notification routes require authentication
notificationsRouter.use(requireAuth);

/**
 * GET /api/notifications
 *
 * List notifications for the authenticated user with pagination.
 * Returns notifications, total count, and unread count.
 */
notificationsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  const offset = parseInt(req.query.offset as string) || 0;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find({ userId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    Notification.countDocuments({ userId }),
    Notification.countDocuments({ userId, isRead: false }),
  ]);

  res.json({ notifications, total, unreadCount });
});

/**
 * GET /api/notifications/unread-count
 *
 * Return the unread notification count only (lightweight query).
 * MUST be defined BEFORE /:id routes to prevent Express param capture.
 */
notificationsRouter.get('/unread-count', async (req: Request, res: Response) => {
  const count = await Notification.countDocuments({
    userId: req.user!.userId,
    isRead: false,
  });
  res.json({ count });
});

/**
 * PATCH /api/notifications/read-all
 *
 * Mark all unread notifications as read for the authenticated user.
 * MUST be defined BEFORE /:id routes to prevent Express param capture.
 */
notificationsRouter.patch('/read-all', async (req: Request, res: Response) => {
  await Notification.updateMany(
    { userId: req.user!.userId, isRead: false },
    { isRead: true, readAt: new Date() },
  );
  res.json({ success: true });
});

/**
 * PATCH /api/notifications/:id/read
 *
 * Mark a single notification as read.
 */
notificationsRouter.patch('/:id/read', async (req: Request, res: Response) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!.userId },
    { isRead: true, readAt: new Date() },
    { new: true },
  );

  if (!notification) {
    throw new NotFoundError('Notification not found');
  }

  res.json(notification);
});

export { notificationsRouter };
