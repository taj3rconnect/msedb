import { Schema, model, type Document, type Types } from 'mongoose';

export interface IEncryptedToken {
  encrypted: string;
  iv: string;
  tag: string;
}

export interface IUserPreferences {
  automationPaused: boolean;
  workingHoursStart: number;
  workingHoursEnd: number;
  aggressiveness: 'conservative' | 'moderate' | 'aggressive';
}

export interface IEncryptedTokens {
  accessToken?: IEncryptedToken;
  refreshToken?: IEncryptedToken;
  expiresAt?: Date;
}

export interface IUser extends Document {
  email: string;
  microsoftId?: string;
  displayName?: string;
  role: 'admin' | 'user';
  isActive: boolean;
  preferences: IUserPreferences;
  encryptedTokens?: IEncryptedTokens;
  msalCache?: string;
  invitedBy?: Types.ObjectId;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const encryptedTokenSchema = new Schema<IEncryptedToken>(
  {
    encrypted: { type: String },
    iv: { type: String },
    tag: { type: String },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true },
    microsoftId: { type: String },
    displayName: { type: String },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    isActive: { type: Boolean, default: true },
    preferences: {
      automationPaused: { type: Boolean, default: false },
      workingHoursStart: { type: Number, default: 9 },
      workingHoursEnd: { type: Number, default: 17 },
      aggressiveness: {
        type: String,
        enum: ['conservative', 'moderate', 'aggressive'],
        default: 'moderate',
      },
    },
    encryptedTokens: {
      accessToken: { type: encryptedTokenSchema },
      refreshToken: { type: encryptedTokenSchema },
      expiresAt: { type: Date },
    },
    msalCache: { type: String },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

// Indexes
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ microsoftId: 1 }, { unique: true, sparse: true });

export const User = model<IUser>('User', userSchema);
