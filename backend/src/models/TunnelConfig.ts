import { Schema, model, type Document } from 'mongoose';

export interface ITunnelConfig extends Document {
  webhookUrl: string;
  isHealthy: boolean;
  lastHealthCheck?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const tunnelConfigSchema = new Schema<ITunnelConfig>(
  {
    webhookUrl: { type: String, default: '' },
    isHealthy: { type: Boolean, default: false },
    lastHealthCheck: { type: Date },
  },
  { timestamps: true },
);

export const TunnelConfig = model<ITunnelConfig>('TunnelConfig', tunnelConfigSchema);

/**
 * Get the singleton tunnel config document (upsert if missing).
 */
export async function getTunnelConfig(): Promise<ITunnelConfig> {
  let doc = await TunnelConfig.findOne();
  if (!doc) {
    doc = await TunnelConfig.create({ webhookUrl: '', isHealthy: false });
  }
  return doc;
}
