import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { User } from '../models/User.js';

const userRouter = Router();

// All user routes require authentication
userRouter.use(requireAuth);

/**
 * PATCH /api/user/preferences
 *
 * Update user preferences (primarily the kill switch toggle).
 * Accepts { automationPaused: boolean } and returns updated preferences.
 */
userRouter.patch('/preferences', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { automationPaused } = req.body;

  if (typeof automationPaused !== 'boolean') {
    res.status(400).json({ error: 'automationPaused must be a boolean' });
    return;
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { 'preferences.automationPaused': automationPaused },
    { new: true },
  );

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    preferences: {
      automationPaused: user.preferences.automationPaused,
      workingHoursStart: user.preferences.workingHoursStart,
      workingHoursEnd: user.preferences.workingHoursEnd,
      aggressiveness: user.preferences.aggressiveness,
    },
  });
});

export { userRouter };
