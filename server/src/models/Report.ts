import { type HydratedDocument, Schema, type Types, model } from 'mongoose';
import {
  REPORT_ACTIONS,
  REPORT_REASONS,
  REPORT_STATUSES,
  type ReportAction,
  type ReportReason,
  type ReportStatus,
} from '@skillswap/shared';

export interface IReport {
  _id: Types.ObjectId;
  reporter: Types.ObjectId;
  reportedUser: Types.ObjectId;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  resolutionNotes: string;
  actionTaken: ReportAction;
  resolvedBy?: Types.ObjectId | null;
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const reportSchema = new Schema<IReport>(
  {
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reportedUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: REPORT_STATUSES, default: 'PENDING' },
    resolutionNotes: { type: String, default: '' },
    actionTaken: { type: String, enum: REPORT_ACTIONS, default: 'NONE' },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ reporter: 1, reportedUser: 1, status: 1 });

export type ReportDoc = HydratedDocument<IReport>;
export const Report = model<IReport>('Report', reportSchema);
