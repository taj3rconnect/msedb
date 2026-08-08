import path from 'node:path';
import winston from 'winston';
import { config } from './index.js';

// Log destination is configurable so the test suite can run outside the
// container. Defaults to the in-container path, so deployed behaviour
// is unchanged.
const logDir = process.env.LOG_DIR ?? '/app/logs';

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'msedb-backend' },
  transports: [
    new winston.transports.Console({
      format:
        config.nodeEnv === 'development'
          ? winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            )
          : winston.format.json(),
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
    }),
  ],
});

export default logger;
