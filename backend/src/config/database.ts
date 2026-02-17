import mongoose from 'mongoose';
import { config } from './index.js';
import logger from './logger.js';

const MAX_RETRIES = 10;
const BASE_DELAY = 1000;
const MAX_DELAY = 30000;

export async function connectDatabase(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await mongoose.connect(config.mongodbUri, {
        maxPoolSize: 50,
        minPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4,
      });

      logger.info('MongoDB connected', { uri: config.mongodbUri.replace(/\/\/.*@/, '//<credentials>@') });

      mongoose.connection.on('error', (err) => {
        logger.error('MongoDB connection error', { error: err.message });
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected. Mongoose will auto-reconnect.');
      });

      return;
    } catch (error) {
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt - 1), MAX_DELAY);
      logger.warn(`MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed. Retrying in ${delay}ms...`, {
        error: error instanceof Error ? error.message : String(error),
      });

      if (attempt === MAX_RETRIES) {
        logger.error('MongoDB connection failed after all retries');
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
