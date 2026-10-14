import type mongoose from 'mongoose';
import type { ContractDTO } from '@skillswap/shared';
import type { AppContext } from '../context';
import { conflict, notFound } from '../lib/errors';
import {
  type ContractDoc,
  ExchangeRequest,
  type IUser,
  LearningContract,
  Session,
  type UserDoc,
} from '../models';
import { type PopulatedContract, toContractDTO } from '../serializers';
import { notify } from './notifications';

const PARTY_FIELDS = 'name username avatar headline';

/** Sessions of a contract that are booked but not finished yet. */
async function scheduledCounts(
  contractIds: mongoose.Types.ObjectId[],
): Promise<Map<string, number>> {
  const rows = await Session.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    { $match: { contract: { $in: contractIds }, status: { $in: ['SCHEDULED', 'ACTIVE'] } } },
    { $group: { _id: '$contract', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.count]));
}

export async function contractDTOs(contracts: PopulatedContract[]): Promise<ContractDTO[]> {
  const counts = await scheduledCounts(contracts.map((c) => c._id));
  return contracts.map((c) => toContractDTO(c, counts.get(c._id.toString()) ?? 0));
}

export async function listContracts(
  user: UserDoc,
  options: { activeOnly?: boolean } = {},
): Promise<ContractDTO[]> {
  const rows = await LearningContract.find({
    $or: [{ userA: user._id }, { userB: user._id }],
    ...(options.activeOnly ? { status: 'ACTIVE' } : {}),
  })
    .populate<{ userA: IUser | null; userB: IUser | null }>('userA userB', PARTY_FIELDS)
    .sort({ status: 1, updatedAt: -1 })
    .limit(100)
    .lean();
  return contractDTOs(rows);
}

/** Loads a contract the member is party to. Anyone else gets the same 404 as a missing id. */
export async function loadContractForParty(
  contractId: string,
  userId: string,
): Promise<ContractDoc> {
  const contract = await LearningContract.findById(contractId);
  if (!contract) throw notFound('Contract');
  const isParty = contract.userA.toString() === userId || contract.userB.toString() === userId;
  if (!isParty) throw notFound('Contract');
  return contract;
}

export async function getContractDTO(
  contractId: mongoose.Types.ObjectId | string,
): Promise<ContractDTO> {
  const row = await LearningContract.findById(contractId)
    .populate<{ userA: IUser | null; userB: IUser | null }>('userA userB', PARTY_FIELDS)
    .lean();
  if (!row) throw notFound('Contract');
  const [dto] = await contractDTOs([row]);
  if (!dto) throw notFound('Contract');
  return dto;
}

export async function getContract(user: UserDoc, contractId: string): Promise<ContractDTO> {
  const contract = await loadContractForParty(contractId, user._id.toString());
  return getContractDTO(contract._id);
}

export async function toggleGoal(
  user: UserDoc,
  contractId: string,
  goalId: string,
): Promise<ContractDTO> {
  const contract = await loadContractForParty(contractId, user._id.toString());
  if (contract.status !== 'ACTIVE') {
    throw conflict('This contract is closed, so its goals can no longer change.');
  }
  const goal = contract.goals.find((g) => g._id.toString() === goalId);
  if (!goal) throw notFound('Goal');
  goal.completed = !goal.completed;
  goal.completedAt = goal.completed ? new Date() : null;
  goal.completedBy = goal.completed ? user._id : null;
  await contract.save();
  return getContractDTO(contract._id);
}

async function closeExchange(
  contract: ContractDoc,
  status: 'COMPLETED' | 'CANCELLED',
  byUserId: mongoose.Types.ObjectId | null,
  note: string,
): Promise<void> {
  await ExchangeRequest.updateOne(
    { _id: contract.exchangeRequest },
    {
      $set: { status },
      $unset: { openPairKey: 1 },
      $push: { statusHistory: { status, changedBy: byUserId, note, timestamp: new Date() } },
    },
  );
}

/** Either party can end a contract early. Upcoming sessions under it are cancelled. */
export async function endContract(
  ctx: AppContext,
  user: UserDoc,
  contractId: string,
): Promise<ContractDTO> {
  const userId = user._id.toString();
  const contract = await loadContractForParty(contractId, userId);
  const updated = await LearningContract.findOneAndUpdate(
    { _id: contract._id, status: 'ACTIVE' },
    { $set: { status: 'TERMINATED', endedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('This contract is already closed.');

  await Session.updateMany(
    { contract: contract._id, status: 'SCHEDULED' },
    { $set: { status: 'CANCELLED' } },
  );
  await closeExchange(updated, 'CANCELLED', user._id, 'Contract ended early');

  const otherId = contract.userA.toString() === userId ? contract.userB : contract.userA;
  await notify(ctx, {
    recipientId: otherId.toString(),
    senderId: userId,
    type: 'CONTRACT_ENDED',
    title: 'Contract ended',
    message: `${user.name} ended your ${contract.skillA} / ${contract.skillB} contract.`,
    link: '/exchanges',
  });
  return getContractDTO(updated._id);
}

/** Counts one finished session towards its contract and closes the contract when all are done. */
export async function recordCompletedSession(
  ctx: AppContext,
  contractId: mongoose.Types.ObjectId | string,
): Promise<void> {
  const contract = await LearningContract.findOneAndUpdate(
    { _id: contractId, status: 'ACTIVE' },
    { $inc: { completedSessions: 1 } },
    { returnDocument: 'after' },
  );
  if (!contract || contract.completedSessions < contract.totalSessions) return;

  const closed = await LearningContract.findOneAndUpdate(
    { _id: contract._id, status: 'ACTIVE' },
    { $set: { status: 'COMPLETED', endedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!closed) return;
  await closeExchange(closed, 'COMPLETED', null, 'All sessions completed');
  for (const recipient of [closed.userA, closed.userB]) {
    await notify(ctx, {
      recipientId: recipient.toString(),
      type: 'CONTRACT_COMPLETED',
      title: 'Contract completed',
      message: `You finished all ${closed.totalSessions} sessions of your ${closed.skillA} / ${closed.skillB} exchange.`,
      link: '/exchanges',
    });
  }
}
