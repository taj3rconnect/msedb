import express, { type Request, type Response, type NextFunction } from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { config } from './config/index.js';
import logger from './config/logger.js';
import { connectDatabase } from './config/database.js';
import { getRedisClient } from './config/redis.js';
import { initializeSchedulers } from './jobs/schedulers.js';
import { closeAllWorkers, closeAllQueues } from './jobs/queues.js';

// Import all models to trigger Mongoose model registration
import './models/index.js';

const app = express();

// Security and compression middleware
app.use(helmet());
app.use(cors({ origin: config.appUrl, credentials: true }));
app.use(compression());
app.use(express.json());

// Health check endpoint (placeholder -- full implementation in Plan 03)
app.get('/api/health', (_req: Request, res: Response) => {
  const redisClient = app.get('redis');
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

  let redisStatus = 'disconnected';
  if (redisClient) {
    redisStatus = redisClient.status === 'ready' ? 'connected' : 'disconnected';
  }

  const healthy = mongoStatus === 'connected' && redisStatus === 'connected';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: {
      mongodb: mongoStatus,
      redis: redisStatus,
    },
  });
});

// Webhook endpoint (placeholder -- full implementation in later phase)
app.post('/webhooks/graph', (_req: Request, res: Response) => {
  res.status(202).json({ status: 'accepted' });
});

// Global error handler (Express 5 -- async errors auto-propagate)
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error:', { error: err.message, stack: err.stack });
  res.status(500).json({
    error: 'Internal server error',
    ...(config.nodeEnv === 'development' && { message: err.message }),
  });
});

// Startup sequence: connect database, verify Redis, initialize schedulers, then listen
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

    // 3. Initialize BullMQ job schedulers
    await initializeSchedulers();

    // 4. Start Express server (only after all infrastructure is ready)
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
    await mongoose.disconnect();
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
