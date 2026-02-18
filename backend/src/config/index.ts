import 'dotenv/config';

interface AppConfig {
  readonly port: number;
  readonly nodeEnv: string;
  readonly mongodbUri: string;
  readonly redisHost: string;
  readonly redisPort: number;
  readonly logLevel: string;
  readonly encryptionKey: string;
  readonly jwtSecret: string;
  readonly sessionSecret: string;
  readonly azureAdTenantId: string;
  readonly azureAdClientId: string;
  readonly azureAdClientSecret: string;
  readonly appUrl: string;
  readonly addinUrl: string;
  readonly apiUrl: string;
  graphWebhookUrl: string; // mutable — updated via admin API
  readonly syncSinceDate: string;
  readonly adminEmail: string;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '8010', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // MongoDB
  mongodbUri: process.env.MONGODB_URI || 'mongodb://msedb-mongo:27017/msedb',

  // Redis
  redisHost: process.env.REDIS_HOST || 'msedb-redis',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',

  // Security
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  jwtSecret: process.env.JWT_SECRET || '',
  sessionSecret: process.env.SESSION_SECRET || '',

  // Azure AD / Microsoft Identity Platform
  azureAdTenantId: process.env.AZURE_AD_TENANT_ID || '',
  azureAdClientId: process.env.AZURE_AD_CLIENT_ID || '',
  azureAdClientSecret: process.env.AZURE_AD_CLIENT_SECRET || '',

  // URLs
  appUrl: process.env.APP_URL || 'http://localhost:3010',
  addinUrl: process.env.ADDIN_URL || 'https://localhost:3000',
  apiUrl: process.env.API_URL || 'http://localhost:8010',
  graphWebhookUrl: process.env.GRAPH_WEBHOOK_URL || '',

  // Sync
  syncSinceDate: process.env.SYNC_SINCE_DATE || '2026-01-01T00:00:00Z',

  // Admin
  adminEmail: process.env.ADMIN_EMAIL || '',
};

export type Config = AppConfig;
