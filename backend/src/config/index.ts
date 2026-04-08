import 'dotenv/config';

interface AppConfig {
  readonly port: number;
  readonly nodeEnv: string;
  readonly mongodbUri: string;
  readonly redisHost: string;
  readonly redisPort: number;
  readonly redisPassword: string;
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

  // AI Search (Qdrant + Ollama)
  readonly qdrantUrl: string;
  readonly qdrantCollection: string;
  readonly ollamaUrl: string;
  readonly ollamaEmbedModel: string;
  readonly ollamaInstructModel: string;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '8010', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // MongoDB
  mongodbUri: process.env.MONGODB_URI || `mongodb://msedb:${encodeURIComponent(process.env.MONGO_PASSWORD || '')}@msedb-mongo:27017/msedb?authSource=admin`,

  // Redis
  redisHost: process.env.REDIS_HOST || 'msedb-redis',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  redisPassword: process.env.REDIS_PASSWORD || '',

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

  // AI Search (Qdrant + Ollama)
  qdrantUrl: process.env.QDRANT_URL || 'http://host.docker.internal:6333',
  qdrantCollection: process.env.QDRANT_COLLECTION || 'msedb-emails',
  ollamaUrl: process.env.OLLAMA_URL || 'http://host.docker.internal:11434',
  ollamaEmbedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
  ollamaInstructModel: process.env.OLLAMA_INSTRUCT_MODEL || 'qwen3:1.7b',
};

// Validate critical secrets at startup
if (config.nodeEnv === 'production') {
  const secretFields = ['encryptionKey', 'jwtSecret', 'sessionSecret'] as const;
  for (const field of secretFields) {
    const value = config[field];
    if (!value || value.length < 32) {
      throw new Error(`${field} must be at least 32 characters (got ${value.length})`);
    }
  }
}

export type Config = AppConfig;
