import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { config } from './config/index.js';
import logger from './config/logger.js';

const app = express();

// Security and compression middleware
app.use(helmet());
app.use(cors({ origin: config.appUrl, credentials: true }));
app.use(compression());
app.use(express.json());

// Health check endpoint (placeholder -- full implementation in Plan 03)
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
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

// Start server
app.listen(config.port, () => {
  logger.info(`MSEDB backend started on port ${config.port}`, {
    environment: config.nodeEnv,
    port: config.port,
  });
});

export default app;
