import type { Types } from 'mongoose';
import type {
  ExchangeAction,
  ExchangeCounterInput,
  ExchangeCreateInput,
  ExchangeDTO,
} from '@skillswap/shared';
import type { AppContext } from '../context';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { pairKey } from '../lib/ids';
import {
  type ExchangeDoc,
  ExchangeRequest,
  type IUser,
  LearningContract,
  User,
  type UserDoc,
} from '../models';
import { awaitingUserId, currentTerms, toExchangeDTO } from '../serializers';
import { notify } from './notifications';

const PARTY_FIELDS = 'name username avatar headline';

const teaches = (user: Pick<IUser, 'skillsTeaching'>, skill: string) =>
  user.skillsTeaching.some((s) => s.skill.toLowerCase() === skill.toLowerCase());

async function loadDTO(
  exchangeId: Types.ObjectId | string,
  viewerId: string,
): Promise<ExchangeDTO> {
  const populated = await ExchangeRequest.findById(exchangeId)
    .populate<{ sender: IUser | null; receiver: IUser | null }>('sender receiver', PARTY_FIELDS)
    .lean();
  if (!populated) throw notFound('Exchange');
  return toExchangeDTO(populated, viewerId);
}

/** Loads an exchange the member is part of. Anyone else gets the same 404 as a missing id. */
async function loadForParty(exchangeId: string, userId: string): Promise<ExchangeDoc> {
  const exchange = await ExchangeRequest.findById(exchangeId);
  if (!exchange) throw notFound('Exchange');
  const isParty = exchange.sender.toString() === userId || exchange.receiver.toString() === userId;
  if (!isParty) throw notFound('Exchange');
  return exchange;
}

const isDuplicateKey = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

export async function createExchange(
  ctx: AppContext,
  sender: UserDoc,
  input: ExchangeCreateInput,
): Promise<ExchangeDTO> {
  const senderId = sender._id.toString();
  if (input.receiverId === senderId) {
    throw badRequest('You cannot propose an exchange with yourself.');
  }
  const receiver = await User.findOne({ _id: input.receiverId, status: 'ACTIVE', role: 'USER' });
  if (!receiver) throw notFound('Member');

  if (!teaches(sender, input.teachingSkill)) {
    throw new AppError(400, 'validation_failed', 'Some fields need attention.', {
      teachingSkill:
        'Pick one of the skills on your profile, or add this one to your profile first.',
    });
  }
  if (!teaches(receiver, input.learningSkill)) {
    throw new AppError(400, 'validation_failed', 'Some fields need attention.', {
      learningSkill: `${receiver.name} does not list this skill.`,
    });
  }

  let created: ExchangeDoc;
  try {
    created = await ExchangeRequest.create({
      sender: sender._id,
      receiver: receiver._id,
      teachingSkill: input.teachingSkill,
      learningSkill: input.learningSkill,
      message: input.message,
      proposedSessions: input.sessions,
      proposedDurationMinutes: input.durationMinutes,
      learningGoals: input.goals,
      status: 'PENDING',
      statusHistory: [{ status: 'PENDING', changedBy: sender._id, note: 'Proposal sent' }],
      openPairKey: pairKey(senderId, receiver._id.toString()),
    });
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw conflict('You already have an open exchange with this member.');
    }
    throw err;
  }

  await notify(ctx, {
    recipientId: receiver._id.toString(),
    senderId,
    type: 'EXCHANGE_REQUEST',
    title: 'New exchange proposal',
    message: `${sender.name} offers ${input.teachingSkill} in exchange for ${input.learningSkill}.`,
    link: '/exchanges',
  });
  return loadDTO(created._id, senderId);
}

export async function listExchanges(
  user: UserDoc,
  box: 'received' | 'sent' | 'all',
): Promise<ExchangeDTO[]> {
  const filter =
    box === 'received'
      ? { receiver: user._id }
      : box === 'sent'
        ? { sender: user._id }
        : { $or: [{ sender: user._id }, { receiver: user._id }] };
  const rows = await ExchangeRequest.find(filter)
    .populate<{ sender: IUser | null; receiver: IUser | null }>('sender receiver', PARTY_FIELDS)
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();
  const viewerId = user._id.toString();
  return rows.map((row) => toExchangeDTO(row, viewerId));
}

/** Exchanges where the member must respond, newest first. */
export async function listAwaiting(user: UserDoc, limit: number): Promise<ExchangeDTO[]> {
  const all = await listExchanges(user, 'all');
  return all.filter((e) => e.viewer.canAccept).slice(0, limit);
}

export async function actOnExchange(
  ctx: AppContext,
  user: UserDoc,
  exchangeId: string,
  action: ExchangeAction,
): Promise<ExchangeDTO> {
  const userId = user._id.toString();
  const exchange = await loadForParty(exchangeId, userId);

  if (exchange.status !== 'PENDING' && exchange.status !== 'COUNTERED') {
    throw conflict(`This exchange is already ${exchange.status.toLowerCase()}.`);
  }
  const awaiting = awaitingUserId(exchange);
  const otherId =
    exchange.sender.toString() === userId
      ? exchange.receiver.toString()
      : exchange.sender.toString();

  if (action === 'cancel') {
    if (awaiting === userId) {
      throw forbidden(
        'Only the member who made the latest offer can withdraw it. You can decline instead.',
      );
    }
  } else if (awaiting !== userId) {
    throw forbidden('This offer is waiting for the other member to respond.');
  }

  const next = action === 'accept' ? 'ACCEPTED' : action === 'decline' ? 'REJECTED' : 'CANCELLED';
  const note =
    action === 'accept'
      ? 'Offer accepted'
      : action === 'decline'
        ? 'Offer declined'
        : 'Offer withdrawn';

  // The filter repeats the state we validated against, so two concurrent responses cannot both win.
  const updated = await ExchangeRequest.findOneAndUpdate(
    { _id: exchange._id, status: exchange.status, updatedAt: exchange.updatedAt },
    {
      $set: { status: next },
      $push: { statusHistory: { status: next, changedBy: user._id, note, timestamp: new Date() } },
      ...(next === 'ACCEPTED' ? {} : { $unset: { openPairKey: 1 } }),
    },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('This exchange was just updated. Refresh and try again.');

  if (next === 'ACCEPTED') {
    const terms = currentTerms(updated);
    const goalTitles =
      terms.goals.length > 0
        ? terms.goals
        : [
            `Cover the fundamentals of ${updated.learningSkill}`,
            `Cover the fundamentals of ${updated.teachingSkill}`,
            'Finish one small project together',
          ];
    try {
      const contract = await LearningContract.create({
        exchangeRequest: updated._id,
        userA: updated.sender,
        userB: updated.receiver,
        skillA: updated.teachingSkill,
        skillB: updated.learningSkill,
        totalSessions: terms.sessions,
        sessionDurationMinutes: terms.durationMinutes,
        schedule: terms.schedule,
        goals: goalTitles.map((title) => ({ title })),
      });
      updated.createdContract = contract._id;
      await updated.save();
    } catch (err) {
      // Without a contract the acceptance is meaningless: put the offer back as it was.
      await ExchangeRequest.updateOne(
        { _id: updated._id },
        { $set: { status: exchange.status }, $pop: { statusHistory: 1 } },
      );
      throw err;
    }
    await notify(ctx, {
      recipientId: otherId,
      senderId: userId,
      type: 'REQUEST_ACCEPTED',
      title: 'Exchange accepted',
      message: `${user.name} accepted. Your learning contract is ready: schedule your first session.`,
      link: '/sessions',
    });
  } else if (next === 'REJECTED') {
    await notify(ctx, {
      recipientId: otherId,
      senderId: userId,
      type: 'REQUEST_REJECTED',
      title: 'Exchange declined',
      message: `${user.name} declined the exchange.`,
      link: '/exchanges',
    });
  } else {
    await notify(ctx, {
      recipientId: otherId,
      senderId: userId,
      type: 'REQUEST_CANCELLED',
      title: 'Offer withdrawn',
      message: `${user.name} withdrew their offer.`,
      link: '/exchanges',
    });
  }
  return loadDTO(updated._id, userId);
}

export async function counterExchange(
  ctx: AppContext,
  user: UserDoc,
  exchangeId: string,
  input: ExchangeCounterInput,
): Promise<ExchangeDTO> {
  const userId = user._id.toString();
  const exchange = await loadForParty(exchangeId, userId);
  if (exchange.status !== 'PENDING' && exchange.status !== 'COUNTERED') {
    throw conflict(`This exchange is already ${exchange.status.toLowerCase()}.`);
  }
  if (awaitingUserId(exchange) !== userId) {
    throw forbidden('This offer is waiting for the other member to respond.');
  }

  const updated = await ExchangeRequest.findOneAndUpdate(
    { _id: exchange._id, status: exchange.status, updatedAt: exchange.updatedAt },
    {
      $set: {
        status: 'COUNTERED',
        counterOffer: {
          sessions: input.sessions,
          durationMinutes: input.durationMinutes,
          schedule: input.schedule,
          goals: currentTerms(exchange).goals,
          message: input.message,
          counteredBy: user._id,
          counteredAt: new Date(),
        },
      },
      $push: {
        statusHistory: {
          status: 'COUNTERED',
          changedBy: user._id,
          note: `Counter-offer: ${input.sessions} × ${input.durationMinutes} min`,
          timestamp: new Date(),
        },
      },
    },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('This exchange was just updated. Refresh and try again.');

  const otherId =
    exchange.sender.toString() === userId
      ? exchange.receiver.toString()
      : exchange.sender.toString();
  await notify(ctx, {
    recipientId: otherId,
    senderId: userId,
    type: 'COUNTER_OFFER',
    title: 'Counter-offer received',
    message: `${user.name} suggested ${input.sessions} sessions of ${input.durationMinutes} minutes.`,
    link: '/exchanges',
  });
  return loadDTO(updated._id, userId);
}
