import { Router, type Request, type Response } from 'express';
import logger from '../config/logger.js';

const router = Router();

/**
 * POST /webhooks/graph
 *
 * Handles Microsoft Graph API webhook notifications.
 *
 * Two modes:
 * 1. Validation handshake: Graph sends ?validationToken=xxx during subscription creation.
 *    Must return the token as text/plain with 200.
 * 2. Actual notifications: Log and return 202 immediately.
 *    CRITICAL: Must respond within 3 seconds. No blocking operations.
 *
 * Real notification processing will be implemented in Phase 3.
 */
router.post('/webhooks/graph', (req: Request, res: Response) => {
  // Handle Graph API validation handshake
  const validationToken = req.query.validationToken as string | undefined;
  if (validationToken) {
    logger.info('Graph webhook validation handshake', {
      validationToken: validationToken.substring(0, 20) + '...',
    });
    res.set('Content-Type', 'text/plain');
    res.status(200).send(validationToken);
    return;
  }

  // Handle actual notifications
  logger.info('Graph webhook notification received', {
    bodyKeys: Object.keys(req.body || {}),
    valueCount: Array.isArray(req.body?.value) ? req.body.value.length : 0,
  });

  // Return 202 immediately -- actual processing via BullMQ in Phase 3
  res.status(202).json({ status: 'accepted' });
});

export default router;
