import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiErrorBody, ContractDTO, ExchangeDTO } from '@skillswap/shared';
import { ExchangeRequest, LearningContract, Notification, Session } from '../src/models';
import {
  type Member,
  type TestApp,
  acceptedContract,
  createTestApp,
  onboard,
  propose,
  signUp,
  tradingPair,
} from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const exchangeOf = (res: { body: unknown }) => (res.body as { exchange: ExchangeDTO }).exchange;
const act = (member: Member, id: string, action: string) =>
  member.agent.post(`/api/exchanges/${id}/action`).send({ action });

describe('proposing an exchange', () => {
  it('creates a pending proposal awaiting the receiver and notifies them', async () => {
    const { ana, ben } = await tradingPair(t);
    const res = await propose(ana, ben);
    expect(res.status).toBe(201);
    const exchange = exchangeOf(res);
    expect(exchange).toMatchObject({
      status: 'PENDING',
      awaitingUserId: ben.user.id,
      viewer: {
        isSender: true,
        canAccept: false,
        canDecline: false,
        canCounter: false,
        canCancel: true,
      },
    });
    expect(
      await Notification.countDocuments({ recipient: ben.user.id, type: 'EXCHANGE_REQUEST' }),
    ).toBe(1);
  });

  it('only allows skills the two members actually list', async () => {
    const { ana, ben } = await tradingPair(t);
    const mine = await propose(ana, ben, { teachingSkill: 'Quantum Physics' });
    expect(mine.status).toBe(400);
    expect((mine.body as ApiErrorBody).error.fields).toHaveProperty('teachingSkill');
    const theirs = await propose(ana, ben, { learningSkill: 'Quantum Physics' });
    expect((theirs.body as ApiErrorBody).error.fields).toHaveProperty('learningSkill');
  });

  it('rejects proposals to yourself, to unknown members and malformed ids', async () => {
    const { ana } = await tradingPair(t);
    expect((await propose(ana, ana)).status).toBe(400);
    expect((await propose(ana, { user: { id: 'f'.repeat(24) } } as Member)).status).toBe(404);
    expect((await propose(ana, { user: { id: '{"$ne":null}' } } as Member)).status).toBe(400);
  });

  it('allows one open exchange per pair, in either direction, even under a race', async () => {
    const { ana, ben } = await tradingPair(t);
    const [a, b] = await Promise.all([
      propose(ana, ben),
      propose(ben, ana, { teachingSkill: 'Video Editing', learningSkill: 'Java' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(
      await ExchangeRequest.countDocuments({
        $or: [{ sender: ana.user.id }, { sender: ben.user.id }],
      }),
    ).toBe(1);
  });
});

describe('responding to a proposal', () => {
  it('does not let the sender accept their own proposal', async () => {
    const { ana, ben } = await tradingPair(t);
    const { id } = exchangeOf(await propose(ana, ben));
    const res = await act(ana, id, 'accept');
    expect(res.status).toBe(403);
    expect(await LearningContract.countDocuments({ exchangeRequest: id })).toBe(0);
  });

  it('hides exchanges from members who are not part of them', async () => {
    const { ana, ben } = await tradingPair(t);
    const outsider = await signUp(t);
    const { id } = exchangeOf(await propose(ana, ben));
    expect((await act(outsider, id, 'accept')).status).toBe(404);
    expect(
      (
        await outsider.agent
          .post(`/api/exchanges/${id}/counter`)
          .send({ sessions: 1, durationMinutes: 30, message: 'x' })
      ).status,
    ).toBe(404);
    const list = (await outsider.agent.get('/api/exchanges')).body as { items: ExchangeDTO[] };
    expect(list.items).toEqual([]);
  });

  it('accepting creates exactly one contract and no surprise session, even when repeated', async () => {
    const { ana, ben } = await tradingPair(t);
    const { id } = exchangeOf(
      await propose(ana, ben, {
        sessions: 3,
        durationMinutes: 45,
        goals: ['Goal one', 'Goal two'],
      }),
    );
    const [first, second] = await Promise.all([act(ben, id, 'accept'), act(ben, id, 'accept')]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect((await act(ben, id, 'accept')).status).toBe(409);

    const contracts = await LearningContract.find({ exchangeRequest: id }).lean();
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({
      skillA: 'Java',
      skillB: 'Video Editing',
      totalSessions: 3,
      sessionDurationMinutes: 45,
      completedSessions: 0,
      status: 'ACTIVE',
    });
    expect(contracts[0]?.goals.map((g) => g.title)).toEqual(['Goal one', 'Goal two']);
    expect(contracts[0]?.userA.toString()).toBe(ana.user.id);
    expect(await Session.countDocuments({ contract: contracts[0]?._id })).toBe(0);
  });

  it('cannot accept, decline or counter once an exchange is settled', async () => {
    const { ana, ben } = await tradingPair(t);
    const { id } = exchangeOf(await propose(ana, ben));
    expect(exchangeOf(await act(ben, id, 'decline')).status).toBe('REJECTED');
    expect((await act(ben, id, 'accept')).status).toBe(409);
    expect((await act(ana, id, 'cancel')).status).toBe(409);
    expect(
      (
        await ben.agent
          .post(`/api/exchanges/${id}/counter`)
          .send({ sessions: 2, durationMinutes: 60, message: 'Late' })
      ).status,
    ).toBe(409);
    // A settled exchange frees the pair for a new proposal.
    expect((await propose(ana, ben)).status).toBe(201);
  });

  it('lets the sender withdraw a pending proposal but not the receiver', async () => {
    const { ana, ben } = await tradingPair(t);
    const { id } = exchangeOf(await propose(ana, ben));
    expect((await act(ben, id, 'cancel')).status).toBe(403);
    expect(exchangeOf(await act(ana, id, 'cancel')).status).toBe('CANCELLED');
  });

  it('rejects unknown actions', async () => {
    const { ana, ben } = await tradingPair(t);
    const { id } = exchangeOf(await propose(ana, ben));
    expect((await act(ben, id, 'ACCEPTED')).status).toBe(400);
    expect((await act(ben, 'not-an-id', 'accept')).status).toBe(404);
  });
});

describe('counter-offers', () => {
  const counter = (member: Member, id: string, body: Record<string, unknown> = {}) =>
    member.agent.post(`/api/exchanges/${id}/counter`).send({
      sessions: 6,
      durationMinutes: 90,
      schedule: 'Sunday mornings',
      message: 'Could we go deeper with longer sessions?',
      ...body,
    });

  it('hands the decision to the other member and applies the countered terms on acceptance', async () => {
    const { ana, ben } = await tradingPair(t);
    const { id } = exchangeOf(await propose(ana, ben, { sessions: 2, durationMinutes: 60 }));

    // Only the awaited member (Ben) can counter.
    expect((await counter(ana, id)).status).toBe(403);
    const countered = exchangeOf(await counter(ben, id));
    expect(countered).toMatchObject({
      status: 'COUNTERED',
      awaitingUserId: ana.user.id,
      currentTerms: { sessions: 6, durationMinutes: 90, schedule: 'Sunday mornings' },
      viewer: { canAccept: false, canCancel: true },
    });
    // The original goals carry over into the counter-offer.
    expect(countered.currentTerms.goals).toEqual(['Learn the basics']);

    // Ben made the latest offer, so Ben cannot accept it; Ana can.
    expect((await act(ben, id, 'accept')).status).toBe(403);
    const accepted = exchangeOf(await act(ana, id, 'accept'));
    expect(accepted.status).toBe('ACCEPTED');

    const contract = await LearningContract.findOne({ exchangeRequest: id }).lean();
    expect(contract).toMatchObject({
      totalSessions: 6,
      sessionDurationMinutes: 90,
      schedule: 'Sunday mornings',
    });
  });

  it('supports several rounds and withdrawal by the latest offerer', async () => {
    const { ana, ben } = await tradingPair(t);
    const { id } = exchangeOf(await propose(ana, ben));
    await counter(ben, id);
    const second = exchangeOf(
      await counter(ana, id, { sessions: 4, durationMinutes: 60, message: 'Meet in the middle?' }),
    );
    expect(second.awaitingUserId).toBe(ben.user.id);
    expect(second.history.map((h) => h.status)).toEqual(['PENDING', 'COUNTERED', 'COUNTERED']);
    expect(exchangeOf(await act(ana, id, 'cancel')).status).toBe('CANCELLED');
  });

  it('validates counter terms', async () => {
    const { ana, ben } = await tradingPair(t);
    const { id } = exchangeOf(await propose(ana, ben));
    expect((await counter(ben, id, { sessions: 99 })).status).toBe(400);
    expect((await counter(ben, id, { durationMinutes: 61 })).status).toBe(400);
    expect((await counter(ben, id, { message: '' })).status).toBe(400);
  });
});

describe('contracts', () => {
  it('are only visible to and editable by their two members', async () => {
    const { ana, ben } = await tradingPair(t);
    const outsider = await signUp(t);
    const { contract } = await acceptedContract(ana, ben);
    const goalId = contract.goals[0]?.id ?? '';

    expect((await outsider.agent.get(`/api/contracts/${contract.id}`)).status).toBe(404);
    expect(
      (await outsider.agent.post(`/api/contracts/${contract.id}/goals/${goalId}/toggle`)).status,
    ).toBe(404);
    expect((await outsider.agent.post(`/api/contracts/${contract.id}/end`)).status).toBe(404);
    expect(
      ((await outsider.agent.get('/api/contracts')).body as { items: ContractDTO[] }).items,
    ).toEqual([]);

    const toggled = await ben.agent.post(`/api/contracts/${contract.id}/goals/${goalId}/toggle`);
    expect(toggled.status).toBe(200);
    const goal = (toggled.body as { contract: ContractDTO }).contract.goals[0];
    expect(goal).toMatchObject({ completed: true, completedByUserId: ben.user.id });
  });

  it('can be ended early by either member, which closes the exchange and frees the pair', async () => {
    const { ana, ben } = await tradingPair(t);
    const { contract, exchange } = await acceptedContract(ana, ben);
    expect((await propose(ana, ben)).status).toBe(409);

    const ended = await ben.agent.post(`/api/contracts/${contract.id}/end`);
    expect((ended.body as { contract: ContractDTO }).contract.status).toBe('TERMINATED');
    expect((await ana.agent.post(`/api/contracts/${contract.id}/end`)).status).toBe(409);
    expect((await ExchangeRequest.findById(exchange.id).lean())?.status).toBe('CANCELLED');
    expect((await propose(ana, ben)).status).toBe(201);
  });
});

describe('listing exchanges', () => {
  it('separates received from sent and computes the viewer actions per member', async () => {
    const { ana, ben } = await tradingPair(t);
    const cara = await signUp(t);
    await onboard(cara, ['Video Editing'], ['Java']);
    await propose(ana, ben);
    await propose(ana, cara);

    const sent = ((await ana.agent.get('/api/exchanges?box=sent')).body as { items: ExchangeDTO[] })
      .items;
    const received = (
      (await ben.agent.get('/api/exchanges?box=received')).body as { items: ExchangeDTO[] }
    ).items;
    expect(sent).toHaveLength(2);
    expect(received).toHaveLength(1);
    expect(received[0]?.viewer).toMatchObject({
      isSender: false,
      canAccept: true,
      canCounter: true,
      canCancel: false,
    });
    expect((await ana.agent.get('/api/exchanges?box=everything')).status).toBe(400);
  });
});
