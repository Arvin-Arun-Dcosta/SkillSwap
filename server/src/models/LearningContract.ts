import { type HydratedDocument, Schema, type Types, model } from 'mongoose';
import { CONTRACT_STATUSES, type ContractStatus } from '@skillswap/shared';

export interface IContractGoal {
  _id: Types.ObjectId;
  title: string;
  completed: boolean;
  completedAt?: Date | null;
  completedBy?: Types.ObjectId | null;
}

export interface ILearningContract {
  _id: Types.ObjectId;
  exchangeRequest: Types.ObjectId;
  /** userA teaches skillA; userB teaches skillB. */
  userA: Types.ObjectId;
  userB: Types.ObjectId;
  skillA: string;
  skillB: string;
  totalSessions: number;
  completedSessions: number;
  sessionDurationMinutes: number;
  schedule: string;
  goals: IContractGoal[];
  startDate: Date;
  endedAt?: Date | null;
  status: ContractStatus;
  createdAt: Date;
  updatedAt: Date;
}

const learningContractSchema = new Schema<ILearningContract>(
  {
    exchangeRequest: { type: Schema.Types.ObjectId, ref: 'ExchangeRequest', required: true },
    userA: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userB: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    skillA: { type: String, required: true },
    skillB: { type: String, required: true },
    totalSessions: { type: Number, default: 4, min: 1 },
    completedSessions: { type: Number, default: 0, min: 0 },
    sessionDurationMinutes: { type: Number, default: 60 },
    schedule: { type: String, default: '' },
    goals: [
      {
        title: { type: String, required: true },
        completed: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      },
    ],
    startDate: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    status: { type: String, enum: CONTRACT_STATUSES, default: 'ACTIVE' },
  },
  { timestamps: true },
);

learningContractSchema.index({ userA: 1, status: 1 });
learningContractSchema.index({ userB: 1, status: 1 });
// Not unique: legacy databases can hold duplicates. Acceptance is made single-shot in the service.
learningContractSchema.index({ exchangeRequest: 1 });

export type ContractDoc = HydratedDocument<ILearningContract>;
export const LearningContract = model<ILearningContract>(
  'LearningContract',
  learningContractSchema,
);
