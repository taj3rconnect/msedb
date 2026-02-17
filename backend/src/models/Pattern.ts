import { Schema, model, type Document, type Types } from 'mongoose';

export interface IPatternCondition {
  senderEmail?: string;
  senderDomain?: string;
  fromFolder?: string;
  subjectPattern?: string;
}

export interface IPatternSuggestedAction {
  actionType: 'delete' | 'move' | 'archive' | 'markRead' | 'flag' | 'categorize';
  toFolder?: string;
  category?: string;
}

export interface IPatternEvidence {
  messageId: string;
  timestamp: Date;
  action: string;
}

export interface IPattern extends Document {
  userId: Types.ObjectId;
  mailboxId: Types.ObjectId;
  patternType: 'sender' | 'folder-routing';
  status: 'detected' | 'suggested' | 'approved' | 'rejected' | 'expired';
  confidence: number;
  sampleSize: number;
  exceptionCount: number;
  condition: IPatternCondition;
  suggestedAction: IPatternSuggestedAction;
  evidence: IPatternEvidence[];
  rejectedAt?: Date;
  rejectionCooldownUntil?: Date;
  approvedAt?: Date;
  lastAnalyzedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const patternSchema = new Schema<IPattern>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mailboxId: { type: Schema.Types.ObjectId, ref: 'Mailbox', required: true },
    patternType: { type: String, enum: ['sender', 'folder-routing'], required: true },
    status: {
      type: String,
      enum: ['detected', 'suggested', 'approved', 'rejected', 'expired'],
      default: 'detected',
    },
    confidence: { type: Number, required: true, min: 0, max: 100 },
    sampleSize: { type: Number, required: true },
    exceptionCount: { type: Number, default: 0 },
    condition: {
      senderEmail: { type: String },
      senderDomain: { type: String },
      fromFolder: { type: String },
      subjectPattern: { type: String },
    },
    suggestedAction: {
      actionType: {
        type: String,
        enum: ['delete', 'move', 'archive', 'markRead', 'flag', 'categorize'],
      },
      toFolder: { type: String },
      category: { type: String },
    },
    evidence: {
      type: [
        {
          messageId: { type: String },
          timestamp: { type: Date },
          action: { type: String },
        },
      ],
      validate: {
        validator: (v: IPatternEvidence[]) => v.length <= 10,
        message: 'Evidence array cannot exceed 10 items',
      },
      default: [],
    },
    rejectedAt: { type: Date },
    rejectionCooldownUntil: { type: Date },
    approvedAt: { type: Date },
    lastAnalyzedAt: { type: Date },
  },
  { timestamps: true }
);

// Indexes
patternSchema.index({ userId: 1, mailboxId: 1, status: 1 });
patternSchema.index({ userId: 1, patternType: 1, 'condition.senderDomain': 1 });
patternSchema.index({ rejectionCooldownUntil: 1 }, { sparse: true });

export const Pattern = model<IPattern>('Pattern', patternSchema);
