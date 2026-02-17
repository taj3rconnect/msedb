import { Schema, model, type Document, type Types } from 'mongoose';

export interface INotificationRelatedEntity {
  entityType: 'pattern' | 'rule' | 'staged_email';
  entityId: Types.ObjectId;
}

export interface INotification extends Document {
  userId: Types.ObjectId;
  type: 'pattern_detected' | 'rule_executed' | 'staging_alert' | 'system' | 'inactivity_warning';
  title: string;
  message: string;
  isRead: boolean;
  readAt?: Date;
  relatedEntity?: INotificationRelatedEntity;
  priority: 'low' | 'normal' | 'high';
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['pattern_detected', 'rule_executed', 'staging_alert', 'system', 'inactivity_warning'],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
    relatedEntity: {
      entityType: {
        type: String,
        enum: ['pattern', 'rule', 'staged_email'],
      },
      entityId: { type: Schema.Types.ObjectId },
    },
    priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
  },
  { timestamps: true }
);

// Indexes
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }); // 30-day TTL

export const Notification = model<INotification>('Notification', notificationSchema);
