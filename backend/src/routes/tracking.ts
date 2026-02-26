import { Router, type Request, type Response } from 'express';
import { TRACKING_PIXEL, recordOpen } from '../services/trackingService.js';

const trackingRouter = Router();

/**
 * GET /track/open/:trackingId.png
 *
 * Public endpoint (no auth). Serves a 1x1 transparent PNG and records the open event.
 * Called when a recipient's email client loads the tracking pixel image.
 */
trackingRouter.get('/open/:trackingId.png', (req: Request, res: Response) => {
  const trackingId = req.params.trackingId as string;

  // Serve the pixel immediately
  res.set({
    'Content-Type': 'image/png',
    'Content-Length': String(TRACKING_PIXEL.length),
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  res.end(TRACKING_PIXEL);

  // Record open asynchronously (fire-and-forget)
  const xff = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  const ip = (typeof xff === 'string' ? xff : Array.isArray(xff) ? xff[0] : '')?.split(',')[0]?.trim()
    || (typeof realIp === 'string' ? realIp : '')
    || req.ip
    || '';
  const ua = req.headers['user-agent'] || '';

  recordOpen(trackingId, ip, ua);
});

export default trackingRouter;
