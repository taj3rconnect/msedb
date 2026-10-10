import { Router } from 'express';
import { requireAuth } from '../../auth/middleware.js';
import listRouter from './list.js';
import aggregatesRouter from './aggregates.js';
import summarizeRouter from './summarize.js';

const eventsRouter = Router();

// All event routes require authentication
eventsRouter.use(requireAuth);

eventsRouter.use(listRouter);
eventsRouter.use(aggregatesRouter);
eventsRouter.use(summarizeRouter);

export { eventsRouter };
