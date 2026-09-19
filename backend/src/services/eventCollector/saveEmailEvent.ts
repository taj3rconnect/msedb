import { EmailEvent, type IEmailEvent } from '../../models/EmailEvent.js';
import { getIO } from '../../config/socket.js';

/**
 * Save an EmailEvent document, handling deduplication via the compound unique index.
 * After a successful save, emits a Socket.IO event to the user's room.
 *
 * @returns true if saved, false if duplicate (silently skipped)
 * @throws Re-throws any error that is not a duplicate key error
 */
export async function saveEmailEvent(
  eventData: Partial<IEmailEvent>,
): Promise<boolean> {
  try {
    const savedEvent = await EmailEvent.create(eventData);

    // Emit Socket.IO event for real-time dashboard updates
    try {
      const io = getIO();
      const userId = String(savedEvent.userId);
      io.to(`user:${userId}`).emit('email:event', {
        id: savedEvent._id,
        eventType: savedEvent.eventType,
        sender: savedEvent.sender,
        subject: savedEvent.subject,
        timestamp: savedEvent.timestamp,
        mailboxId: savedEvent.mailboxId,
      });
    } catch {
      // Socket.IO not initialized (e.g., during tests) -- ignore silently
    }

    return true;
  } catch (err: unknown) {
    // MongoDB duplicate key error code 11000 -- silently skip
    if (
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: number }).code === 11000
    ) {
      return false;
    }
    throw err;
  }
}
