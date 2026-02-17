import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import logger from './config/logger.js';
import { connectDatabase } from './config/database.js';
import { getRedisClient } from './config/redis.js';
import { initializeSchedulers } from './jobs/schedulers.js';
import { closeAllWorkers, closeAllQueues } from './jobs/queues.js';
import { configureSecurityMiddleware } from './middleware/security.js';
import { createAuthLimiter, createApiLimiter } from './middleware/rateLimiter.js';
import { globalErrorHandler } from './middleware/errorHandler.js';
import healthRouter from './routes/health.js';
import webhooksRouter from './routes/webhooks.js';
import authRouter from './auth/routes.js';
import adminRouter from './routes/admin.js';
import mailboxRouter from './routes/mailbox.js';

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

    // 5. Start Express server (only after all infrastructure is ready)
    app.listen(config.port, () => {
      logger.info(`MSEDB backend started on port ${config.port}`, {
        environment: config.nodeEnv,
        port: config.port,
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
