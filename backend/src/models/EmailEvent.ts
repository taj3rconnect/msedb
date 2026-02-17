import { Schema, model, type Document, type Types } from 'mongoose';

export interface IEmailEventSender {
  name?: string;
  email?: string;
  domain?: string;
}

export interface IEmailEventMetadata {
  hasListUnsubscribe?: boolean;
  isNewsletter?: boolean;
  isAutomated?: boolean;
  automatedByRule?: Types.ObjectId;
}

export interface IEmailEvent extends Document {
  userId: Types.ObjectId;
  mailboxId: Types.ObjectId;
  messageId: string;
  internetMessageId?: string;
  eventType: 'arrived' | 'deleted' | 'moved' | 'read' | 'flagged' | 'categorized';
  timestamp: Date;
  sender: IEmailEventSender;
  subject?: string;
  subjectNormalized?: string;
  receivedAt?: Date;
  timeToAction?: number;
  fromFolder?: string;
  toFolder?: string;
  importance: 'low' | 'normal' | 'high';
  hasAttachments: boolean;
  conversationId?: string;
  categories: string[];
  isRead: boolean;
  metadata: IEmailEventMetadata;
  createdAt: Date;
  updatedAt: Date;
}

const emailEventSchema = new Schema<IEmailEvent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mailboxId: { type: Schema.Types.ObjectId, ref: 'Mailbox', required: true },
    messageId: { type: String, required: true },
    internetMessageId: { type: String },
    eventType: {
      type: String,
      enum: ['arrived', 'deleted', 'moved', 'read', 'flagged', 'categorized'],
      required: true,
    },
    timestamp: { type: Date, default: Date.now },
    sender: {
      name: { type: String },
      email: { type: String },
      domain: { type: String },
    },
    subject: { type: String },
    subjectNormalized: { type: String },
    receivedAt: { type: Date },
    timeToAction: { type: Number },
    fromFolder: { type: String },
    toFolder: { type: String },
    importance: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
    hasAttachments: { type: Boolean, default: false },
    conversationId: { type: String },
    categories: { type: [String], default: [] },
    isRead: { type: Boolean, default: false },
    metadata: {
      hasListUnsubscribe: { type: Boolean },
      isNewsletter: { type: Boolean },
      isAutomated: { type: Boolean },
      automatedByRule: { type: Schema.Types.ObjectId, ref: 'Rule' },
    },
  },
  { timestamps: true }
);

// Compound indexes for query performance
emailEventSchema.index({ userId: 1, 'sender.domain': 1, timestamp: -1 });
emailEventSchema.index({ userId: 1, eventType: 1, timestamp: -1 });
emailEventSchema.index(
  { userId: 1, mailboxId: 1, messageId: 1, eventType: 1 },
  { unique: true }
); // Dedup
emailEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // 90-day TTL

export const EmailEvent = model<IEmailEvent>('EmailEvent', emailEventSchema);
