import { Schema, model, type Document, type Types } from 'mongoose';

export interface IWebhookSubscription extends Document {
  userId: Types.ObjectId;
  mailboxId: Types.ObjectId;
  subscriptionId: string;
  resource: string;
  changeType: string;
  expiresAt: Date;
  notificationUrl: string;
  lifecycleNotificationUrl?: string;
  clientState: string;
  status: 'active' | 'expired' | 'failed';
  lastNotificationAt?: Date;
  errorCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const webhookSubscriptionSchema = new Schema<IWebhookSubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mailboxId: { type: Schema.Types.ObjectId, ref: 'Mailbox', required: true },
    subscriptionId: { type: String, required: true },
    resource: { type: String, required: true },
    changeType: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    notificationUrl: { type: String, required: true },
    lifecycleNotificationUrl: { type: String },
    clientState: { type: String, required: true },
    status: { type: String, enum: ['active', 'expired', 'failed'], default: 'active' },
    lastNotificationAt: { type: Date },
    errorCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Indexes
webhookSubscriptionSchema.index({ subscriptionId: 1 }, { unique: true });
webhookSubscriptionSchema.index({ userId: 1, mailboxId: 1 });
webhookSubscriptionSchema.index({ expiresAt: 1, status: 1 });

export const WebhookSubscription = model<IWebhookSubscription>(
  'WebhookSubscription',
  webhookSubscriptionSchema
);
