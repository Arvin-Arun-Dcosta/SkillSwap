import { type HydratedDocument, Schema, type Types, model } from 'mongoose';
import { EXCHANGE_STATUSES, type ExchangeStatus } from '@skillswap/shared';

export interface ICounterOffer {
  sessions: number;
  durationMinutes: number;
  schedule: string;
  goals: string[];
  message: string;
  counteredBy: Types.ObjectId;
  counteredAt: Date;
}

export interface IExchangeRequest {
  _id: Types.ObjectId;
  sender: Types.ObjectId;
  receiver: Types.ObjectId;
  /** What the sender offers to teach. */
  teachingSkill: string;
  /** What the sender wants to learn from the receiver. */
  learningSkill: string;
  message: string;
  proposedSessions: number;
  proposedDurationMinutes: number;
  learningGoals: string[];
  status: ExchangeStatus;
  counterOffer?: ICounterOffer | null;
  statusHistory: {
    status: ExchangeStatus;
    changedBy?: Types.ObjectId | null;
    note: string;
    timestamp: Date;
  }[];
  createdContract?: Types.ObjectId | null;
  /**
   * Set to the pair key of the two members while the exchange is open and removed when it closes.
   * The sparse unique index on it guarantees one open exchange per pair, even under concurrency.
   */
  openPairKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const counterOfferSchema = new Schema<ICounterOffer>(
  {
    sessions: { type: Number, required: true },
    durationMinutes: { type: Number, required: true },
    schedule: { type: String, default: '' },
    goals: { type: [String], default: [] },
    message: { type: String, default: '' },
    counteredBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    counteredAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const exchangeRequestSchema = new Schema<IExchangeRequest>(
  {
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    teachingSkill: { type: String, required: true },
    learningSkill: { type: String, required: true },
    message: { type: String, required: true },
    proposedSessions: { type: Number, default: 4 },
    proposedDurationMinutes: { type: Number, default: 60 },
    learningGoals: { type: [String], default: [] },
    status: { type: String, enum: EXCHANGE_STATUSES, default: 'PENDING' },
    counterOffer: { type: counterOfferSchema, default: null },
    statusHistory: [
      {
        _id: false,
        status: { type: String, enum: EXCHANGE_STATUSES },
        changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        note: { type: String, default: '' },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    createdContract: { type: Schema.Types.ObjectId, ref: 'LearningContract', default: null },
    openPairKey: { type: String },
  },
  { timestamps: true },
);

exchangeRequestSchema.index({ sender: 1, updatedAt: -1 });
exchangeRequestSchema.index({ receiver: 1, updatedAt: -1 });
exchangeRequestSchema.index({ openPairKey: 1 }, { unique: true, sparse: true });

export type ExchangeDoc = HydratedDocument<IExchangeRequest>;
export const ExchangeRequest = model<IExchangeRequest>('ExchangeRequest', exchangeRequestSchema);
