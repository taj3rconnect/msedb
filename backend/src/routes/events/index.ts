import { Router } from 'express';
import { requireAuth } from '../../auth/middleware.js';
import listRouter from './list.js';
import summarizeRouter from './summarize.js';

const eventsRouter = Router();

// All event routes require authentication
eventsRouter.use(requireAuth);

// Paths are disjoint across sub-routers, so mount order is not load-bearing.
eventsRouter.use(listRouter);
eventsRouter.use(summarizeRouter);

export { eventsRouter };
