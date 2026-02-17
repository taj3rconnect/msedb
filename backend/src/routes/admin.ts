import { Router, type Request, type Response } from 'express';
import { User } from '../models/User.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../middleware/errorHandler.js';
import logger from '../config/logger.js';

const adminRouter = Router();

// All admin routes require authentication and admin role
adminRouter.use(requireAuth, requireAdmin);

// Simple email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/admin/invite
 *
 * Invite a new user by email and optionally assign a role.
 * Returns 409 if the user already exists.
 */
adminRouter.post('/invite', async (req: Request, res: Response) => {
  const { email, role } = req.body as { email?: string; role?: string };

  if (!email || !EMAIL_REGEX.test(email)) {
    throw new ValidationError('A valid email address is required');
  }

  if (role && role !== 'admin' && role !== 'user') {
    throw new ValidationError('Role must be "admin" or "user"');
  }

  const normalizedEmail = email.toLowerCase();

  // Check if user already exists
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw new ConflictError('A user with this email already exists');
  }

  const user = await User.create({
    email: normalizedEmail,
    role: role || 'user',
    isActive: true,
    invitedBy: req.user!.userId,
  });

  logger.info('User invited', {
    email: user.email,
    role: user.role,
    invitedBy: req.user!.userId,
  });

  res.status(201).json({
    id: user._id,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  });
});

/**
 * GET /api/admin/users
 *
 * List all users with key fields.
 */
adminRouter.get('/users', async (_req: Request, res: Response) => {
  const users = await User.find()
    .select('email displayName role isActive lastLoginAt createdAt')
    .sort({ createdAt: -1 });

  res.json(users);
});

/**
 * PATCH /api/admin/users/:id/role
 *
 * Change a user's role. Admin cannot demote themselves.
 */
adminRouter.patch('/users/:id/role', async (req: Request, res: Response) => {
  const { role } = req.body as { role?: string };

  if (!role || (role !== 'admin' && role !== 'user')) {
    throw new ValidationError('Role must be "admin" or "user"');
  }

  // Prevent admin from demoting themselves
  if (req.params.id === req.user!.userId && role !== 'admin') {
    throw new ValidationError('Cannot change your own role');
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { role },
    { new: true },
  );

  if (!user) {
    throw new NotFoundError('User not found');
  }

  logger.info('User role updated', {
    targetUserId: user._id.toString(),
    newRole: role,
    updatedBy: req.user!.userId,
  });

  res.json({
    id: user._id,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  });
});

/**
 * PATCH /api/admin/users/:id/deactivate
 *
 * Deactivate a user. Admin cannot deactivate themselves.
 */
adminRouter.patch(
  '/users/:id/deactivate',
  async (req: Request, res: Response) => {
    // Prevent admin from deactivating themselves
    if (req.params.id === req.user!.userId) {
      throw new ValidationError('Cannot deactivate your own account');
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true },
    );

    if (!user) {
      throw new NotFoundError('User not found');
    }

    logger.info('User deactivated', {
      targetUserId: user._id.toString(),
      deactivatedBy: req.user!.userId,
    });

    res.json({
      id: user._id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    });
  },
);

export default adminRouter;
