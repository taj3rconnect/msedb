import { Schema, model, type Document, type Types } from 'mongoose';

export interface ITrackedEmailOpen {
  timestamp: Date;
  ip?: string;
  userAgent?: string;
  device?: string;
  browser?: string;
  os?: string;
  country?: string;
  city?: string;
}

export interface ITrackedEmail extends Document {
  trackingId: string;
  userId: Types.ObjectId;
  mailboxId: Types.ObjectId;
  subject?: string;
  recipients: string[];
  sentAt: Date;
  opens: ITrackedEmailOpen[];
  openCount: number;
  firstOpenedAt?: Date;
  lastOpenedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const trackedEmailOpenSchema = new Schema<ITrackedEmailOpen>(
  {
    timestamp: { type: Date, required: true },
    ip: { type: String },
    userAgent: { type: String },
    device: { type: String },
    browser: { type: String },
    os: { type: String },
    country: { type: String },
    city: { type: String },
  },
  { _id: false },
);

const trackedEmailSchema = new Schema<ITrackedEmail>(
  {
    trackingId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mailboxId: { type: Schema.Types.ObjectId, ref: 'Mailbox', required: true },
    subject: { type: String },
    recipients: [{ type: String }],
    sentAt: { type: Date, required: true, index: true },
    opens: [trackedEmailOpenSchema],
    openCount: { type: Number, default: 0 },
    firstOpenedAt: { type: Date },
    lastOpenedAt: { type: Date },
  },
  {
    timestamps: true,
  },
);

// Compound index for batch lookup matching
trackedEmailSchema.index({ mailboxId: 1, subject: 1, sentAt: 1 });

// TTL: auto-delete after 180 days
trackedEmailSchema.index({ sentAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export const TrackedEmail = model<ITrackedEmail>('TrackedEmail', trackedEmailSchema);
