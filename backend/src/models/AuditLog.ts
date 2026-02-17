import { Schema, model, type Document, type Types } from 'mongoose';

export type AuditAction =
  | 'rule_created'
  | 'rule_updated'
  | 'rule_deleted'
  | 'rule_executed'
  | 'email_staged'
  | 'email_rescued'
  | 'email_executed'
  | 'pattern_approved'
  | 'pattern_rejected'
  | 'automation_paused'
  | 'automation_resumed'
  | 'undo_action'
  | 'whitelist_updated';

export type AuditTargetType = 'email' | 'rule' | 'pattern' | 'settings';

export interface IAuditLog extends Document {
  userId: Types.ObjectId;
  mailboxId?: Types.ObjectId;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string;
  details?: Record<string, unknown>;
  undoable: boolean;
  undoneAt?: Date;
  undoneBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mailboxId: { type: Schema.Types.ObjectId, ref: 'Mailbox' },
    action: {
      type: String,
      enum: [
        'rule_created',
        'rule_updated',
        'rule_deleted',
        'rule_executed',
        'email_staged',
        'email_rescued',
        'email_executed',
        'pattern_approved',
        'pattern_rejected',
        'automation_paused',
        'automation_resumed',
        'undo_action',
        'whitelist_updated',
      ],
      required: true,
    },
    targetType: {
      type: String,
      enum: ['email', 'rule', 'pattern', 'settings'],
      required: true,
    },
    targetId: { type: String },
    details: { type: Schema.Types.Mixed },
    undoable: { type: Boolean, default: false },
    undoneAt: { type: Date },
    undoneBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Indexes
auditLogSchema.index({ userId: 1, action: 1, createdAt: -1 });
auditLogSchema.index({ userId: 1, mailboxId: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);
