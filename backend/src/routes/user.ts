import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { User } from '../models/User.js';
import { ValidationError, NotFoundError } from '../middleware/errorHandler.js';

const userRouter = Router();

// All user routes require authentication
userRouter.use(requireAuth);

/**
 * PATCH /api/user/preferences
 *
 * Update user preferences. Accepts any combination of:
 * - automationPaused (boolean) -- kill switch toggle
 * - workingHoursStart (number 0-23)
 * - workingHoursEnd (number 0-23)
 * Only provided fields are updated (field-level $set to prevent kill switch overwrite).
 */
userRouter.patch('/preferences', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { automationPaused, workingHoursStart, workingHoursEnd, contactsMailboxId, contactsFolderId } = req.body;

  const updateFields: Record<string, unknown> = {};

  if (typeof automationPaused === 'boolean') {
    updateFields['preferences.automationPaused'] = automationPaused;
  } else if (automationPaused !== undefined) {
    throw new ValidationError('automationPaused must be a boolean');
  }

  if (typeof workingHoursStart === 'number') {
    if (!Number.isInteger(workingHoursStart) || workingHoursStart < 0 || workingHoursStart > 23) {
      throw new ValidationError('workingHoursStart must be an integer between 0 and 23');
    }
    updateFields['preferences.workingHoursStart'] = workingHoursStart;
  } else if (workingHoursStart !== undefined) {
    throw new ValidationError('workingHoursStart must be a number');
  }

  if (typeof workingHoursEnd === 'number') {
    if (!Number.isInteger(workingHoursEnd) || workingHoursEnd < 0 || workingHoursEnd > 23) {
      throw new ValidationError('workingHoursEnd must be an integer between 0 and 23');
    }
    updateFields['preferences.workingHoursEnd'] = workingHoursEnd;
  } else if (workingHoursEnd !== undefined) {
    throw new ValidationError('workingHoursEnd must be a number');
  }

  if (typeof contactsMailboxId === 'string') {
    updateFields['preferences.contactsMailboxId'] = contactsMailboxId;
  } else if (contactsMailboxId !== undefined) {
    throw new ValidationError('contactsMailboxId must be a string');
  }

  if (typeof contactsFolderId === 'string') {
    updateFields['preferences.contactsFolderId'] = contactsFolderId;
  } else if (contactsFolderId !== undefined) {
    throw new ValidationError('contactsFolderId must be a string');
  }

  if (Object.keys(updateFields).length === 0) {
    throw new ValidationError('No valid preference fields provided');
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $set: updateFields },
    { new: true },
  );

  if (!user) {
    throw new NotFoundError('User not found');
  }

  res.json({
    preferences: {
      automationPaused: user.preferences.automationPaused,
      workingHoursStart: user.preferences.workingHoursStart,
      workingHoursEnd: user.preferences.workingHoursEnd,
      contactsMailboxId: user.preferences.contactsMailboxId,
      contactsFolderId: user.preferences.contactsFolderId,
    },
  });
});

export { userRouter };
