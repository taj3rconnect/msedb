import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import logger from './config/logger.js';
import { connectDatabase } from './config/database.js';
import { getRedisClient } from './config/redis.js';
import { initializeSchedulers } from './jobs/schedulers.js';
import { closeAllWorkers, closeAllQueues } from './jobs/queues.js';
import { syncSubscriptionsOnStartup } from './services/subscriptionService.js';
import { initializeTunnelConfig } from './services/tunnelService.js';
import { configureSecurityMiddleware } from './middleware/security.js';
import { createAuthLimiter, createApiLimiter } from './middleware/rateLimiter.js';
import { globalErrorHandler } from './middleware/errorHandler.js';
import healthRouter from './routes/health.js';
import webhooksRouter from './routes/webhooks.js';
import authRouter from './auth/routes.js';
import adminRouter from './routes/admin.js';
import mailboxRouter from './routes/mailbox.js';
import { dashboardRouter } from './routes/dashboard.js';
import { userRouter } from './routes/user.js';
import { eventsRouter } from './routes/events.js';
import { patternsRouter } from './routes/patterns.js';
import { rulesRouter } from './routes/rules.js';
import { stagingRouter } from './routes/staging.js';
import { auditRouter } from './routes/audit.js';
import { notificationsRouter } from './routes/notifications.js';
import { settingsRouter } from './routes/settings.js';
import { createSocketServer } from './config/socket.js';

// Import all models to trigger Mongoose model registration
import './models/index.js';

const app = express();

// Security middleware (helmet, cors, compression, body parsing)
configureSecurityMiddleware(app);

// Cookie parser (must be before auth routes that read cookies)
app.use(cookieParser());

// Mount health endpoint (no rate limiting)
app.use(healthRouter);

// Mount webhook endpoint (no rate limiting -- Microsoft controls the rate)
app.use(webhooksRouter);

// Mount auth routes (login, callback, logout, me)
app.use(authRouter);

// Mount admin routes (requireAuth + requireAdmin applied internally)
app.use('/api/admin', adminRouter);

// Mount mailbox routes (requireAuth applied internally)
app.use('/api/mailboxes', mailboxRouter);

// Mount dashboard routes (requireAuth applied internally)
app.use('/api/dashboard', dashboardRouter);

// Mount user routes -- dedicated router for kill switch (requireAuth applied internally)
app.use('/api/user', userRouter);

// Mount events routes (requireAuth applied internally)
app.use('/api/events', eventsRouter);

// Mount patterns routes (requireAuth applied internally)
app.use('/api/patterns', patternsRouter);

// Mount rules routes (requireAuth applied internally)
app.use('/api/rules', rulesRouter);

// Mount staging routes (requireAuth applied internally)
app.use('/api/staging', stagingRouter);

// Mount audit routes (requireAuth applied internally)
app.use('/api/audit', auditRouter);

// Mount notification routes (requireAuth applied internally)
app.use('/api/notifications', notificationsRouter);

// Mount settings routes (requireAuth applied internally)
app.use('/api/settings', settingsRouter);

// Global error handler (must be last middleware)
app.use(globalErrorHandler);

// Startup sequence: connect database, verify Redis, apply rate limiters, initialize schedulers, then listen
async function startServer(): Promise<void> {
  try {
    // 1. Connect to MongoDB with retry logic
    await connectDatabase();

    // 2. Verify Redis connection
    const redisClient = getRedisClient();
    const pong = await redisClient.ping();
    logger.info('Redis connection verified', { response: pong });

    // Store redis client on app for health checks
    app.set('redis', redisClient);

    // 3. Apply rate limiters (Redis must be ready before creating limiters)
    app.use('/auth', createAuthLimiter());
    app.use('/api', createApiLimiter());

    // 4. Initialize BullMQ job schedulers
    await initializeSchedulers();

    // 5. Initialize tunnel config from DB / env / container detection
    await initializeTunnelConfig();

    // 6. Create Socket.IO server and start listening BEFORE webhook sync
    // (Graph validates webhook URL during subscription creation, so server must be listening)
    const { httpServer, io } = createSocketServer(app);
    app.set('io', io);

    httpServer.listen(config.port, () => {
      logger.info(`MSEDB backend started on port ${config.port}`, {
        environment: config.nodeEnv,
        port: config.port,
      });

      // 7. Sync webhook subscriptions AFTER server is listening
      if (!config.graphWebhookUrl) {
        logger.warn('No tunnel URL configured -- webhook subscriptions will fail until set via dashboard');
      }
      syncSubscriptionsOnStartup().catch((err) => {
        logger.error('Subscription sync failed on startup', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

// Graceful shutdown handler
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    // Close BullMQ workers first (stop processing)
    await closeAllWorkers();

    // Close BullMQ queues
    await closeAllQueues();

    // Disconnect Mongoose
    const mongoose = await import('mongoose');
    await mongoose.default.disconnect();
    logger.info('MongoDB disconnected');

    // Close general Redis client
    const redisClient = app.get('redis');
    if (redisClient) {
      await redisClient.quit();
      logger.info('Redis client closed');
    }

    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();

export default app;
