import type { Express } from 'express';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { config } from '../config/index.js';
import logger from '../config/logger.js';

/**
 * Configure security middleware bundle: helmet, CORS, compression, body parsing.
 * Call this once during app setup, before route mounting.
 */
export function configureSecurityMiddleware(app: Express): void {
  // HTTP security headers
  app.use(helmet());

  // CORS configuration -- allow both frontend dashboard and Outlook add-in origins
  const allowedOrigins = [config.appUrl, config.addinUrl];
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (non-browser clients, e.g. curl, server-to-server)
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Response compression
  app.use(compression());

  // Body parsing with size limits
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  logger.info('Security middleware configured', {
    cors: { origins: allowedOrigins },
    helmet: 'enabled',
    compression: 'enabled',
    bodyLimit: '1mb',
  });
}
