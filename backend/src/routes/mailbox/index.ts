import { Router } from 'express';
import { requireAuth } from '../../auth/middleware.js';
import whitelistRouter from './whitelist.js';
import connectionRouter from './connection.js';
import foldersRouter from './folders.js';
import actionsRouter from './actions.js';
import messagesRouter from './messages.js';
import composeRouter from './compose.js';
import contactsRouter from './contacts.js';
import aiRouter from './ai.js';
import settingsRouter from './settings.js';

const mailboxRouter = Router();

// All mailbox routes require authentication — applied once, here only.
mailboxRouter.use(requireAuth);

// NOTE on mount order: no bare `/:id` route exists anywhere in this router,
// so cross-subrouter mount order is currently safe. Adding a bare `/:id`
// handler to any subrouter would shadow literal paths like `/deleted-count-all`,
// `/autocomplete`, `/connect`, `/org-whitelist` depending on where it's mounted.
mailboxRouter.use(whitelistRouter); // org-whitelist first (documented convention)
mailboxRouter.use(connectionRouter); // owns bare '/' and root-level static paths
mailboxRouter.use(foldersRouter);
mailboxRouter.use(actionsRouter);
mailboxRouter.use(messagesRouter);
mailboxRouter.use(composeRouter);
mailboxRouter.use(contactsRouter);
mailboxRouter.use(aiRouter);
mailboxRouter.use(settingsRouter);

export default mailboxRouter;
