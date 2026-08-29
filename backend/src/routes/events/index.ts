import { Router } from 'express';
import { requireAuth } from '../../auth/middleware.js';
import listRouter from './list.js';
import analyticsRouter from './analytics.js';
import summaryRouter from './summary.js';

const eventsRouter = Router();

// All event routes require authentication
eventsRouter.use(requireAuth);

eventsRouter.use(listRouter);
eventsRouter.use(analyticsRouter);
eventsRouter.use(summaryRouter);

export { eventsRouter };
