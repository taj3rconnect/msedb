import { Schema, model, type Document, type Types } from 'mongoose';

export interface ICalendarMirror {
  mailboxId: Types.ObjectId;
  eventId: string;
}

export interface ICalendarSyncMap extends Document {
  userId: Types.ObjectId;
  sourceMailboxId: Types.ObjectId;
  sourceEventId: string;
  subject: string;
  startDateTime: Date;
  endDateTime: Date;
  isAllDay: boolean;
  mirrors: ICalendarMirror[];
  isDeleted: boolean;
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const calendarMirrorSchema = new Schema<ICalendarMirror>(
  {
    mailboxId: { type: Schema.Types.ObjectId, ref: 'Mailbox', required: true },
    eventId: { type: String, required: true },
  },
  { _id: false }
);

const calendarSyncMapSchema = new Schema<ICalendarSyncMap>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sourceMailboxId: { type: Schema.Types.ObjectId, ref: 'Mailbox', required: true },
    sourceEventId: { type: String, required: true },
    subject: { type: String, default: '' },
    startDateTime: { type: Date, required: true },
    endDateTime: { type: Date, required: true },
    isAllDay: { type: Boolean, default: false },
    mirrors: { type: [calendarMirrorSchema], default: [] },
    isDeleted: { type: Boolean, default: false },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Look up by source
calendarSyncMapSchema.index({ sourceMailboxId: 1, sourceEventId: 1 }, { unique: true });
// Look up by mirror event ID (for loop prevention)
calendarSyncMapSchema.index({ 'mirrors.mailboxId': 1, 'mirrors.eventId': 1 });
// List all events for a user
calendarSyncMapSchema.index({ userId: 1, isDeleted: 1, startDateTime: 1 });

export const CalendarSyncMap = model<ICalendarSyncMap>('CalendarSyncMap', calendarSyncMapSchema);
