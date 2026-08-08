import { Router } from 'express';
import { requireAuth } from '../../auth/middleware.js';
import listRouter from './list.js';
import crudRouter from './crud.js';
import graphSyncRouter from './graphSync.js';
import executeRouter from './execute.js';

const rulesRouter = Router();

// All rule routes require authentication
rulesRouter.use(requireAuth);

// NOTE on mount order: crudRouter owns both PUT /reorder and PUT /:id, and
// /reorder MUST stay ahead of /:id within that router (see crud.ts) to avoid
// 'reorder' being captured as an :id parameter. No other sub-router here
// registers a conflicting path/method pair, so mount order among the rest
// is not load-bearing.
rulesRouter.use(listRouter);
rulesRouter.use(crudRouter);
rulesRouter.use(graphSyncRouter);
rulesRouter.use(executeRouter);

export { rulesRouter };
