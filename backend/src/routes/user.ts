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

/**
 * PATCH /api/user/pattern-settings
 *
 * Update pattern engine settings. All fields optional.
 * Validates ranges: thresholds 50-100, window 7-365, cooldown 3-90, minEvents 2-20.
 */
userRouter.patch('/pattern-settings', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const {
    thresholdDelete,
    thresholdMove,
    thresholdMarkRead,
    observationWindowDays,
    rejectionCooldownDays,
    minSenderEvents,
  } = req.body;

  const updateFields: Record<string, unknown> = {};

  function validateThreshold(value: unknown, name: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 50 || value > 100) {
      throw new ValidationError(`${name} must be an integer between 50 and 100`);
    }
    return value;
  }

  if (thresholdDelete !== undefined) {
    updateFields['patternSettings.thresholdDelete'] = validateThreshold(thresholdDelete, 'thresholdDelete');
  }
  if (thresholdMove !== undefined) {
    updateFields['patternSettings.thresholdMove'] = validateThreshold(thresholdMove, 'thresholdMove');
  }
  if (thresholdMarkRead !== undefined) {
    updateFields['patternSettings.thresholdMarkRead'] = validateThreshold(thresholdMarkRead, 'thresholdMarkRead');
  }
  if (observationWindowDays !== undefined) {
    if (typeof observationWindowDays !== 'number' || !Number.isInteger(observationWindowDays) || observationWindowDays < 7 || observationWindowDays > 365) {
      throw new ValidationError('observationWindowDays must be an integer between 7 and 365');
    }
    updateFields['patternSettings.observationWindowDays'] = observationWindowDays;
  }
  if (rejectionCooldownDays !== undefined) {
    if (typeof rejectionCooldownDays !== 'number' || !Number.isInteger(rejectionCooldownDays) || rejectionCooldownDays < 3 || rejectionCooldownDays > 90) {
      throw new ValidationError('rejectionCooldownDays must be an integer between 3 and 90');
    }
    updateFields['patternSettings.rejectionCooldownDays'] = rejectionCooldownDays;
  }
  if (minSenderEvents !== undefined) {
    if (typeof minSenderEvents !== 'number' || !Number.isInteger(minSenderEvents) || minSenderEvents < 2 || minSenderEvents > 20) {
      throw new ValidationError('minSenderEvents must be an integer between 2 and 20');
    }
    updateFields['patternSettings.minSenderEvents'] = minSenderEvents;
  }

  if (Object.keys(updateFields).length === 0) {
    throw new ValidationError('No valid pattern setting fields provided');
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $set: updateFields },
    { new: true },
  );

  if (!user) {
    throw new NotFoundError('User not found');
  }

  res.json({ patternSettings: user.patternSettings });
});

export { userRouter };
