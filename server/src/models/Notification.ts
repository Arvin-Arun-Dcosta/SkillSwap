import { type HydratedDocument, Schema, type Types, model } from 'mongoose';
import { NOTIFICATION_TYPES, type NotificationType } from '@skillswap/shared';

export interface INotification {
  _id: Types.ObjectId;
  recipient: Types.ObjectId;
  sender?: Types.ObjectId | null;
  type: NotificationType;
  title: string;
  message: string;
  link: string;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Legacy databases contain types that are no longer produced, so the enum is not enforced on read.
    type: { type: String, required: true, default: 'SYSTEM' satisfies NotificationType },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String, default: '' },
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
);

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

export const KNOWN_NOTIFICATION_TYPES: readonly string[] = NOTIFICATION_TYPES;
export type NotificationDoc = HydratedDocument<INotification>;
export const Notification = model<INotification>('Notification', notificationSchema);
