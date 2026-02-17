import { Schema, model, type Document, type Types } from 'mongoose';

export interface IStagedEmailAction {
  actionType: string;
  toFolder?: string;
}

export interface IStagedEmail extends Document {
  userId: Types.ObjectId;
  mailboxId: Types.ObjectId;
  ruleId: Types.ObjectId;
  messageId: string;
  originalFolder: string;
  stagedAt: Date;
  expiresAt: Date;
  cleanupAt?: Date;
  status: 'staged' | 'executed' | 'rescued' | 'expired';
  actions: IStagedEmailAction[];
  executedAt?: Date;
  rescuedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const stagedEmailSchema = new Schema<IStagedEmail>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mailboxId: { type: Schema.Types.ObjectId, ref: 'Mailbox', required: true },
    ruleId: { type: Schema.Types.ObjectId, ref: 'Rule', required: true },
    messageId: { type: String, required: true },
    originalFolder: { type: String, required: true },
    stagedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    cleanupAt: { type: Date },
    status: {
      type: String,
      enum: ['staged', 'executed', 'rescued', 'expired'],
      default: 'staged',
    },
    actions: [
      {
        actionType: { type: String, required: true },
        toFolder: { type: String },
      },
    ],
    executedAt: { type: Date },
    rescuedAt: { type: Date },
  },
  { timestamps: true }
);

// Indexes
stagedEmailSchema.index({ userId: 1, status: 1, expiresAt: 1 });
stagedEmailSchema.index({ cleanupAt: 1 }, { expireAfterSeconds: 0 }); // TTL at cleanupAt (expiresAt + 7 days buffer)

export const StagedEmail = model<IStagedEmail>('StagedEmail', stagedEmailSchema);
