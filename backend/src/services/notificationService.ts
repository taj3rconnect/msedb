import { Notification, type INotification } from '../models/Notification.js';
import { getIO } from '../config/socket.js';
import logger from '../config/logger.js';

interface CreateNotificationParams {
  userId: string;
  type: INotification['type'];
  title: string;
  message: string;
  priority?: INotification['priority'];
  relatedEntity?: INotification['relatedEntity'];
}

/**
 * Create a notification document and emit a Socket.IO event to the user's room.
 *
 * All notification producers (jobs, route handlers, services) should use this
 * function instead of directly calling Notification.create() so that the
 * Socket.IO real-time push is guaranteed.
 */
export async function createNotification(
  params: CreateNotificationParams,
): Promise<INotification> {
  const notification = await Notification.create({
    userId: params.userId,
    type: params.type,
    title: params.title,
    message: params.message,
    priority: params.priority ?? 'normal',
    relatedEntity: params.relatedEntity,
  });

  // Emit via Socket.IO for real-time delivery
  try {
    const io = getIO();
    io.to(`user:${params.userId}`).emit('notification:new', {
      id: notification._id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      priority: notification.priority,
      isRead: false,
      createdAt: notification.createdAt,
      relatedEntity: notification.relatedEntity,
    });
  } catch {
    // Socket.IO not initialized (tests, worker processes) -- silent
    logger.debug('Socket.IO emission skipped for notification', {
      notificationId: notification._id,
      userId: params.userId,
    });
  }

  return notification;
}
