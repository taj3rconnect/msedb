import { Router } from 'express';
import { requireAuth } from '../../auth/middleware.js';
import listRouter from './list.js';
import statsRouter from './stats.js';
import summarizeRouter from './summarize.js';

const eventsRouter = Router();

// All event routes require authentication
eventsRouter.use(requireAuth);

eventsRouter.use(listRouter);
eventsRouter.use(statsRouter);
eventsRouter.use(summarizeRouter);

export { eventsRouter };
