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
  /**
   * Rule-action provenance. Set ONLY when a RULE performed the action -- never
   * when the user marks read / deletes by hand from the inbox. The inbox
   * "Read" and "Deleted" filters key off these two timestamps, so a manual
   * action leaking a stamp in here would silently misreport what automation
   * did. Written by utils/ruleActionStamp.ts; a rescued staged email has its
   * ruleDeletedAt cleared again (services/stagingManager.ts).
   */
  ruleMarkedReadAt?: Date;
  ruleMarkedReadBy?: Types.ObjectId;
  ruleDeletedAt?: Date;
  ruleDeletedBy?: Types.ObjectId;
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
  isDeleted: boolean;
  metadata: IEmailEventMetadata;
  embeddedAt?: Date;
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
    isDeleted: { type: Boolean, default: false },
    metadata: {
      hasListUnsubscribe: { type: Boolean },
      isNewsletter: { type: Boolean },
      isAutomated: { type: Boolean },
      automatedByRule: { type: Schema.Types.ObjectId, ref: 'Rule' },
      ruleMarkedReadAt: { type: Date },
      ruleMarkedReadBy: { type: Schema.Types.ObjectId, ref: 'Rule' },
      ruleDeletedAt: { type: Date },
      ruleDeletedBy: { type: Schema.Types.ObjectId, ref: 'Rule' },
    },
    // Set by embeddingService.embedEmail() on successful Qdrant upsert.
    // Absence + timestamp >= reconcile cutoff = a real gap the reconciler
    // should re-enqueue (see jobs/processors/embeddingReconcile.ts).
    embeddedAt: { type: Date },
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
emailEventSchema.index({ messageId: 1, timestamp: -1 });
emailEventSchema.index({ userId: 1, timestamp: -1 });
emailEventSchema.index({ receivedAt: 1 });
// Supports the hourly embedding-reconcile scan (eventType + isDeleted
// equality, timestamp range); embeddedAt existence is filtered in-memory
// over the already-narrowed result set.
emailEventSchema.index({ eventType: 1, isDeleted: 1, timestamp: 1 });
// Back the inbox "Read"/"Deleted" rule-action filters. SPARSE because only the
// small minority of events a rule actually touched carry these fields -- a
// non-sparse index here would add ~493k near-empty entries for no gain.
emailEventSchema.index(
  { userId: 1, 'metadata.ruleMarkedReadAt': -1 },
  { sparse: true }
);
emailEventSchema.index(
  { userId: 1, 'metadata.ruleDeletedAt': -1 },
  { sparse: true }
);
emailEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // 90-day TTL

export const EmailEvent = model<IEmailEvent>('EmailEvent', emailEventSchema);
