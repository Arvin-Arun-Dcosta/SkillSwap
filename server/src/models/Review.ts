import { type HydratedDocument, Schema, type Types, model } from 'mongoose';

export interface IReview {
  _id: Types.ObjectId;
  session?: Types.ObjectId | null;
  contract?: Types.ObjectId | null;
  reviewer: Types.ObjectId;
  reviewee: Types.ObjectId;
  /** The role the reviewed member had in the session. */
  role: 'TEACHER' | 'STUDENT';
  skill: string;
  rating: number;
  feedback: string;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<IReview>(
  {
    session: { type: Schema.Types.ObjectId, ref: 'Session', default: null },
    contract: { type: Schema.Types.ObjectId, ref: 'LearningContract', default: null },
    reviewer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reviewee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['TEACHER', 'STUDENT'], required: true },
    skill: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    feedback: { type: String, default: '', maxlength: 1000 },
  },
  { timestamps: true },
);

reviewSchema.index({ reviewee: 1, createdAt: -1 });
// One review per member per session: the database enforces what the service checks.
// Partial, because reviews imported from older versions may not reference a session.
reviewSchema.index(
  { session: 1, reviewer: 1 },
  { unique: true, partialFilterExpression: { session: { $type: 'objectId' } } },
);

export type ReviewDoc = HydratedDocument<IReview>;
export const Review = model<IReview>('Review', reviewSchema);
