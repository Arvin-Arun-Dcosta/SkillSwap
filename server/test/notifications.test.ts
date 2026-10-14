import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NotificationList } from '@skillswap/shared';
import { Notification } from '../src/models';
import { type TestApp, createTestApp, propose, tradingPair } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('notifications', () => {
  it('belong to their recipient and can be marked read individually or all at once', async () => {
    const { ana, ben } = await tradingPair(t);
    await propose(ana, ben);

    const list = (await ben.agent.get('/api/notifications')).body as NotificationList;
    expect(list.unreadCount).toBe(1);
    expect(list.items[0]).toMatchObject({
      type: 'EXCHANGE_REQUEST',
      read: false,
      link: '/exchanges',
    });
    expect(list.items[0]?.sender?.id).toBe(ana.user.id);

    const id = list.items[0]?.id ?? '';
    // Someone else's notification looks like it does not exist.
    expect((await ana.agent.post(`/api/notifications/${id}/read`)).status).toBe(404);
    expect((await ben.agent.post(`/api/notifications/${id}/read`)).status).toBe(204);
    expect(((await ben.agent.get('/api/notifications')).body as NotificationList).unreadCount).toBe(
      0,
    );

    await Notification.create({ recipient: ben.user.id, type: 'SYSTEM', title: 'A', message: 'B' });
    expect((await ben.agent.post('/api/notifications/read-all')).status).toBe(204);
    expect(await Notification.countDocuments({ recipient: ben.user.id, read: false })).toBe(0);
  });

  it('never return links that leave the app', async () => {
    const { ben } = await tradingPair(t);
    // Written straight to the collection, the way a document from an older version would look.
    await Notification.collection.insertOne({
      recipient: new mongoose.Types.ObjectId(ben.user.id),
      type: 'LEGACY_TYPE',
      title: 'Old',
      message: 'From a previous version',
      link: 'https://evil.example/phish',
      read: false,
      createdAt: new Date(Date.now() - 1000),
      updatedAt: new Date(),
    });
    await Notification.create({
      recipient: ben.user.id,
      type: 'SYSTEM',
      title: 'x',
      message: 'y',
      link: '//evil.example',
    });
    const list = (await ben.agent.get('/api/notifications')).body as NotificationList;
    expect(list.items.map((n) => n.link)).toEqual(['', '']);
    expect(list.items.map((n) => n.type)).toEqual(['SYSTEM', 'SYSTEM']);
  });
});
