import { type HydratedDocument, Schema, type Types, model } from 'mongoose';

export interface IMessage {
  _id: Types.ObjectId;
  /** Room code of the session the message belongs to. */
  sessionId: string;
  sender: Types.ObjectId;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    sessionId: { type: String, required: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, trim: true, default: '', maxlength: 2000 },
  },
  { timestamps: true },
);

messageSchema.index({ sessionId: 1, createdAt: 1 });

export type MessageDoc = HydratedDocument<IMessage>;
export const Message = model<IMessage>('Message', messageSchema);
