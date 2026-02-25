import { Schema, model, type Document, type Types } from 'mongoose';

export interface IScheduledEmail extends Document {
  userId: Types.ObjectId;
  mailboxId: Types.ObjectId;
  mailboxEmail: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  contentType: 'Text' | 'HTML';
  scheduledAt: Date;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  sentAt?: Date;
  cancelledAt?: Date;
  error?: string;
  cleanupAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const scheduledEmailSchema = new Schema<IScheduledEmail>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mailboxId: { type: Schema.Types.ObjectId, ref: 'Mailbox', required: true },
    mailboxEmail: { type: String, required: true },
    to: [{ type: String, required: true }],
    cc: [{ type: String }],
    bcc: [{ type: String }],
    subject: { type: String, required: true },
    body: { type: String, required: true },
    contentType: { type: String, enum: ['Text', 'HTML'], default: 'HTML' },
    scheduledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'sent', 'cancelled', 'failed'],
      default: 'pending',
    },
    sentAt: { type: Date },
    cancelledAt: { type: Date },
    error: { type: String },
    cleanupAt: { type: Date },
  },
  { timestamps: true }
);

// Indexes
scheduledEmailSchema.index({ userId: 1, status: 1, scheduledAt: 1 });
scheduledEmailSchema.index({ cleanupAt: 1 }, { expireAfterSeconds: 0 }); // TTL: auto-remove 30 days after sent/cancelled

export const ScheduledEmail = model<IScheduledEmail>('ScheduledEmail', scheduledEmailSchema);
