#!/bin/sh
set -e
cd /home/admin/claude/autorefactor/lanes/msedb-2026-10-10-070001/backend/src/routes
mkdir events_d
mk() {
  name=$1; range=$2; var=$3; imports=$4
  {
    printf '%s\n\nconst %s = Router();\n\n' "$imports" "$var"
    sed -n "$range"p events.ts | sed "s/eventsRouter/$var/g"
    printf '\nexport default %s;\n' "$var"
  } > events_d/$name.ts
}
BASE="import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { getUserId } from '../../auth/middleware.js';
import { EmailEvent } from '../../models/EmailEvent.js';"
mk list 20,281 listRouter "$BASE
import { Mailbox } from '../../models/Mailbox.js';
import { getFolderName } from '../../services/folderCache.js';
import { getRedisClient } from '../../config/redis.js';
import { parsePagination } from '../../utils/pagination.js';"
mk aggregates 283,375 aggregatesRouter "$BASE"
mk summarize 377,658 summarizeRouter "$BASE
import { Mailbox } from '../../models/Mailbox.js';
import { getRedisClient } from '../../config/redis.js';
import { graphFetch } from '../../services/graphClient.js';
import { getAccessTokenForMailbox } from '../../auth/tokenManager.js';
import { AppError, ValidationError } from '../../middleware/errorHandler.js';
import { generateOllamaCompletion } from '../../services/ollamaClient.js';
import { config } from '../../config/index.js';"
cat > events_d/index.ts <<'EOF'
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
EOF
git rm -q -f events.ts
mv events_d events
