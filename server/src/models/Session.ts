import { type HydratedDocument, Schema, type Types, model } from 'mongoose';
import {
  EDITOR_LANGUAGE_IDS,
  type EditorLanguage,
  SESSION_STATUSES,
  type SessionStatus,
} from '@skillswap/shared';

export interface ISharedFile {
  _id: Types.ObjectId;
  name: string;
  /** File name on disk inside the upload directory. Never exposed to clients. */
  storedName: string;
  size: number;
  type: string;
  uploader: Types.ObjectId;
  uploadedAt: Date;
}

export interface ISession {
  _id: Types.ObjectId;
  title: string;
  description: string;
  contract?: Types.ObjectId | null;
  participants: Types.ObjectId[];
  teacher: Types.ObjectId;
  learner: Types.ObjectId;
  skillTaught: string;
  scheduledStartTime: Date;
  scheduledEndTime: Date;
  actualStartTime?: Date | null;
  actualEndTime?: Date | null;
  durationMinutes: number;
  status: SessionStatus;
  roomCode: string;
  /** Plain-text snapshots of the shared document, refreshed whenever it is persisted. */
  notes: string;
  codeEditorState: { language: EditorLanguage; code: string };
  /** Encoded Yjs document holding code, notes and whiteboard strokes. */
  collabState?: Buffer | null;
  sharedFiles: ISharedFile[];
  /** Members who actually entered the room. A session only counts when both did. */
  joinedBy: Types.ObjectId[];
  /** Members who have already reviewed their partner for this session. */
  reviewedBy: Types.ObjectId[];
  endedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 500 },
    contract: { type: Schema.Types.ObjectId, ref: 'LearningContract', default: null },
    participants: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
    teacher: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    learner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    skillTaught: { type: String, required: true },
    scheduledStartTime: { type: Date, required: true },
    scheduledEndTime: { type: Date, required: true },
    actualStartTime: { type: Date, default: null },
    actualEndTime: { type: Date, default: null },
    durationMinutes: { type: Number, default: 60 },
    status: { type: String, enum: SESSION_STATUSES, default: 'SCHEDULED' },
    roomCode: { type: String, required: true, unique: true },
    notes: { type: String, default: '' },
    codeEditorState: {
      language: { type: String, enum: EDITOR_LANGUAGE_IDS, default: 'javascript' },
      code: { type: String, default: '' },
    },
    collabState: { type: Buffer, default: null, select: false },
    sharedFiles: [
      {
        name: { type: String, required: true },
        storedName: { type: String, required: true },
        size: { type: Number, default: 0 },
        type: { type: String, default: 'application/octet-stream' },
        uploader: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    joinedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    reviewedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    endedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

sessionSchema.index({ participants: 1, scheduledStartTime: 1 });
sessionSchema.index({ contract: 1, status: 1 });

export type SessionDoc = HydratedDocument<ISession>;
export const Session = model<ISession>('Session', sessionSchema);
