import { Schema, model, type Document, type Types } from 'mongoose';
import type { IEncryptedToken } from './User.js';

export interface IMailboxSettings {
  automationPaused: boolean;
  whitelistedSenders: string[];
  whitelistedDomains: string[];
}

export interface IMailbox extends Document {
  userId: Types.ObjectId;
  email: string;
  displayName?: string;
  tenantId?: string;
  isConnected: boolean;
  encryptedTokens?: {
    accessToken?: IEncryptedToken;
    refreshToken?: IEncryptedToken;
    expiresAt?: Date;
  };
  msalCache?: string;
  lastSyncAt?: Date;
  deltaLinks: Map<string, string>;
  settings: IMailboxSettings;
  createdAt: Date;
  updatedAt: Date;
}

const encryptedTokenSchema = new Schema(
  {
    encrypted: { type: String },
    iv: { type: String },
    tag: { type: String },
  },
  { _id: false }
);

const mailboxSchema = new Schema<IMailbox>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    email: { type: String, required: true },
    displayName: { type: String },
    tenantId: { type: String },
    isConnected: { type: Boolean, default: true },
    encryptedTokens: {
      accessToken: { type: encryptedTokenSchema },
      refreshToken: { type: encryptedTokenSchema },
      expiresAt: { type: Date },
    },
    msalCache: { type: String },
    lastSyncAt: { type: Date },
    deltaLinks: { type: Map, of: String, default: new Map() },
    settings: {
      automationPaused: { type: Boolean, default: false },
      whitelistedSenders: { type: [String], default: [] },
      whitelistedDomains: { type: [String], default: [] },
    },
  },
  { timestamps: true }
);

// Indexes
mailboxSchema.index({ userId: 1, email: 1 }, { unique: true });
mailboxSchema.index({ userId: 1 });

export const Mailbox = model<IMailbox>('Mailbox', mailboxSchema);
