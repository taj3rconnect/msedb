import { Schema, model, type Document, type Types } from 'mongoose';

export interface IRuleConditions {
  senderEmail?: string | string[];
  senderDomain?: string;
  subjectContains?: string;
  bodyContains?: string;
  fromFolder?: string;
}

export interface IRuleAction {
  actionType: 'move' | 'delete' | 'markRead' | 'flag' | 'categorize' | 'archive';
  toFolder?: string;
  category?: string;
  order?: number;
}

export interface IRuleStats {
  totalExecutions: number;
  lastExecutedAt?: Date;
  emailsProcessed: number;
}

export interface IRule extends Document {
  userId: Types.ObjectId;
  mailboxId?: Types.ObjectId;
  name: string;
  sourcePatternId?: Types.ObjectId;
  isEnabled: boolean;
  priority: number;
  conditions: IRuleConditions;
  actions: IRuleAction[];
  stats: IRuleStats;
  graphRuleId?: string;
  scope: 'user' | 'org';
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ruleSchema = new Schema<IRule>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mailboxId: { type: Schema.Types.ObjectId, ref: 'Mailbox', required: false },
    name: { type: String, required: true },
    sourcePatternId: { type: Schema.Types.ObjectId, ref: 'Pattern' },
    isEnabled: { type: Boolean, default: true },
    priority: { type: Number, default: 0 },
    conditions: {
      senderEmail: { type: Schema.Types.Mixed },
      senderDomain: { type: String },
      subjectContains: { type: String },
      bodyContains: { type: String },
      fromFolder: { type: String },
    },
    actions: [
      {
        actionType: {
          type: String,
          enum: ['move', 'delete', 'markRead', 'flag', 'categorize', 'archive'],
          required: true,
        },
        toFolder: { type: String },
        category: { type: String },
        order: { type: Number },
      },
    ],
    stats: {
      totalExecutions: { type: Number, default: 0 },
      lastExecutedAt: { type: Date },
      emailsProcessed: { type: Number, default: 0 },
    },
    graphRuleId: { type: String },
    scope: { type: String, enum: ['user', 'org'], default: 'user' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Indexes
ruleSchema.index({ userId: 1, mailboxId: 1, isEnabled: 1, priority: 1 });
ruleSchema.index({ graphRuleId: 1 }, { sparse: true });

export const Rule = model<IRule>('Rule', ruleSchema);
