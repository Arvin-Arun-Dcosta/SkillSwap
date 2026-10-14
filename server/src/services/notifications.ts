import type { NotificationList, NotificationType } from '@skillswap/shared';
import type { AppContext } from '../context';
import { notFound } from '../lib/errors';
import { Notification, type IUser } from '../models';
import { toNotificationDTO } from '../serializers';

const SENDER_FIELDS = 'name username avatar headline';

export interface NotifyInput {
  recipientId: string;
  senderId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  link: string;
}

/** Stores a notification and pushes it to the recipient if they are connected. Never throws. */
export async function notify(ctx: AppContext, input: NotifyInput): Promise<void> {
  try {
    const created = await Notification.create({
      recipient: input.recipientId,
      sender: input.senderId ?? null,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link,
    });
    const populated = await Notification.findById(created._id)
      .populate<{ sender: IUser | null }>('sender', SENDER_FIELDS)
      .lean();
    if (populated) ctx.realtime.pushNotification(input.recipientId, toNotificationDTO(populated));
  } catch (err) {
    // A failed notification must not fail the action that triggered it.
    ctx.log.warn({ err, type: input.type }, 'could not deliver notification');
  }
}

export async function listNotifications(userId: string): Promise<NotificationList> {
  const [items, unreadCount] = await Promise.all([
    Notification.find({ recipient: userId })
      .populate<{ sender: IUser | null }>('sender', SENDER_FIELDS)
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
    Notification.countDocuments({ recipient: userId, read: false }),
  ]);
  return { items: items.map(toNotificationDTO), unreadCount };
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  const result = await Notification.updateOne(
    { _id: notificationId, recipient: userId },
    { read: true },
  );
  if (result.matchedCount === 0) throw notFound('Notification');
}

export async function markAllRead(userId: string): Promise<void> {
  await Notification.updateMany({ recipient: userId, read: false }, { read: true });
}
