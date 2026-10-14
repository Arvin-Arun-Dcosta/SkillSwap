import type { Types } from 'mongoose';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import type {
  SessionCreateInput,
  SessionDTO,
  SessionDetail,
  SessionReviewInput,
  SessionStatus,
  SharedFile,
} from '@skillswap/shared';
import type { AppContext } from '../context';
import { AppError, conflict, forbidden, notFound } from '../lib/errors';
import { generateRoomCode } from '../lib/ids';
import { type IUser, Review, Session, type SessionDoc, User, type UserDoc } from '../models';
import { toSessionDTO, toSessionDetail, toSharedFile } from '../serializers';
import { getContractDTO, loadContractForParty, recordCompletedSession } from './contracts';
import { notify } from './notifications';
import { recomputeUserStats } from './stats';

const PARTY_FIELDS = 'name username avatar headline';
const MAX_FILES_PER_SESSION = 20;

const isParticipant = (session: Pick<SessionDoc, 'participants'>, userId: string) =>
  session.participants.some((p) => p.toString() === userId);

const partnerOf = (session: Pick<SessionDoc, 'participants'>, userId: string) =>
  session.participants.find((p) => p.toString() !== userId)?.toString() ?? null;

/** Loads a session the member takes part in. Anyone else gets the same 404 as a missing id. */
export async function loadSessionForParticipant(
  where: { _id: string } | { roomCode: string },
  userId: string,
): Promise<SessionDoc> {
  const session = await Session.findOne(where);
  if (!session || !isParticipant(session, userId)) throw notFound('Session');
  return session;
}

async function loadDTO(sessionId: Types.ObjectId | string, viewerId: string): Promise<SessionDTO> {
  const row = await Session.findById(sessionId)
    .populate<{ teacher: IUser | null; learner: IUser | null }>('teacher learner', PARTY_FIELDS)
    .lean();
  if (!row) throw notFound('Session');
  return toSessionDTO(row, viewerId);
}

export async function createSession(
  ctx: AppContext,
  user: UserDoc,
  input: SessionCreateInput,
): Promise<SessionDTO> {
  const userId = user._id.toString();
  const contract = await loadContractForParty(input.contractId, userId);
  if (contract.status !== 'ACTIVE') {
    throw conflict('This contract is closed, so no more sessions can be scheduled.');
  }

  const skill = input.skill.toLowerCase();
  const teachesA = contract.skillA.toLowerCase() === skill;
  const teachesB = contract.skillB.toLowerCase() === skill;
  if (!teachesA && !teachesB) {
    throw new AppError(400, 'validation_failed', 'Some fields need attention.', {
      skill: 'Pick one of the two skills in this contract.',
    });
  }
  const teacher = teachesA ? contract.userA : contract.userB;
  const learner = teachesA ? contract.userB : contract.userA;
  const skillName = teachesA ? contract.skillA : contract.skillB;

  const booked = await Session.countDocuments({
    contract: contract._id,
    status: { $in: ['SCHEDULED', 'ACTIVE'] },
  });
  if (contract.completedSessions + booked >= contract.totalSessions) {
    throw conflict(
      `All ${contract.totalSessions} sessions of this contract are already scheduled or completed.`,
    );
  }

  const start = input.scheduledStartTime;
  const created = await Session.create({
    title: input.title || `${skillName} session`,
    description: input.description,
    contract: contract._id,
    participants: [contract.userA, contract.userB],
    teacher,
    learner,
    skillTaught: skillName,
    scheduledStartTime: start,
    scheduledEndTime: new Date(start.getTime() + contract.sessionDurationMinutes * 60_000),
    durationMinutes: contract.sessionDurationMinutes,
    roomCode: generateRoomCode(),
  });

  const partnerId = partnerOf(created, userId);
  if (partnerId) {
    await notify(ctx, {
      recipientId: partnerId,
      senderId: userId,
      type: 'UPCOMING_SESSION',
      title: 'Session scheduled',
      message: `${user.name} scheduled "${created.title}".`,
      link: '/sessions',
    });
  }
  return loadDTO(created._id, userId);
}

const STATUS_ORDER: Record<SessionStatus, number> = {
  ACTIVE: 0,
  SCHEDULED: 1,
  COMPLETED: 2,
  CANCELLED: 3,
};

export async function listSessions(
  user: UserDoc,
  options: { openOnly?: boolean; limit?: number } = {},
): Promise<SessionDTO[]> {
  const rows = await Session.find({
    participants: user._id,
    ...(options.openOnly ? { status: { $in: ['SCHEDULED', 'ACTIVE'] } } : {}),
  })
    .populate<{ teacher: IUser | null; learner: IUser | null }>('teacher learner', PARTY_FIELDS)
    .sort({ scheduledStartTime: 1 })
    .limit(200)
    .lean();
  const viewerId = user._id.toString();
  const sorted = rows.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    const delta =
      new Date(a.scheduledStartTime).getTime() - new Date(b.scheduledStartTime).getTime();
    // Upcoming sessions soonest first; finished ones most recent first.
    return a.status === 'COMPLETED' || a.status === 'CANCELLED' ? -delta : delta;
  });
  return sorted.slice(0, options.limit ?? 200).map((row) => toSessionDTO(row, viewerId));
}

export async function getSessionDetail(user: UserDoc, roomCode: string): Promise<SessionDetail> {
  const userId = user._id.toString();
  const row = await Session.findOne({ roomCode })
    .populate<{ teacher: IUser | null; learner: IUser | null }>('teacher learner', PARTY_FIELDS)
    .lean();
  if (!row || !row.participants.some((p) => p.toString() === userId)) throw notFound('Session');
  const contract = row.contract ? await getContractDTO(row.contract).catch(() => null) : null;
  return toSessionDetail(row, userId, contract);
}

export async function cancelSession(
  ctx: AppContext,
  user: UserDoc,
  sessionId: string,
): Promise<SessionDTO> {
  const userId = user._id.toString();
  const session = await loadSessionForParticipant({ _id: sessionId }, userId);
  const updated = await Session.findOneAndUpdate(
    { _id: session._id, status: 'SCHEDULED' },
    { $set: { status: 'CANCELLED', endedBy: user._id } },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('Only sessions that have not started can be cancelled.');

  const partnerId = partnerOf(session, userId);
  if (partnerId) {
    await notify(ctx, {
      recipientId: partnerId,
      senderId: userId,
      type: 'SESSION_CANCELLED',
      title: 'Session cancelled',
      message: `${user.name} cancelled "${session.title}".`,
      link: '/sessions',
    });
  }
  return loadDTO(updated._id, userId);
}

/**
 * Ends a running session. It happens at most once (the update is conditional on the status), and
 * it only counts as completed when both members were in the room; otherwise it is cancelled, so
 * nobody can build a session count or leave reviews without the other person taking part.
 */
export async function endSession(
  ctx: AppContext,
  user: UserDoc,
  sessionId: string,
): Promise<SessionDTO> {
  const userId = user._id.toString();
  const session = await loadSessionForParticipant({ _id: sessionId }, userId);
  if (session.status !== 'ACTIVE') {
    throw conflict(
      session.status === 'SCHEDULED'
        ? 'This session has not started yet.'
        : `This session is already ${session.status.toLowerCase()}.`,
    );
  }
  const bothJoined = session.participants.every((p) =>
    session.joinedBy.some((j) => j.toString() === p.toString()),
  );
  const status: SessionStatus = bothJoined ? 'COMPLETED' : 'CANCELLED';

  const updated = await Session.findOneAndUpdate(
    { _id: session._id, status: 'ACTIVE' },
    { $set: { status, actualEndTime: new Date(), endedBy: user._id } },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('This session was just ended.');

  await ctx.realtime.endRoom(updated.roomCode, { byUserId: userId, status });

  const partnerId = partnerOf(session, userId);
  if (status === 'COMPLETED') {
    if (updated.contract) await recordCompletedSession(ctx, updated.contract);
    await Promise.all(updated.participants.map((p) => recomputeUserStats(p.toString())));
    if (partnerId) {
      await notify(ctx, {
        recipientId: partnerId,
        senderId: userId,
        type: 'SESSION_COMPLETED',
        title: 'Session completed',
        message: `"${session.title}" is done. Leave ${user.name} a review.`,
        link: '/sessions',
      });
    }
  } else if (partnerId) {
    await notify(ctx, {
      recipientId: partnerId,
      senderId: userId,
      type: 'SESSION_CANCELLED',
      title: 'Session closed',
      message: `"${session.title}" was closed before you both joined. You can schedule it again.`,
      link: '/sessions',
    });
  }
  return loadDTO(updated._id, userId);
}

export async function reviewSession(
  ctx: AppContext,
  user: UserDoc,
  sessionId: string,
  input: SessionReviewInput,
): Promise<SessionDTO> {
  const userId = user._id.toString();
  const session = await loadSessionForParticipant({ _id: sessionId }, userId);
  if (session.status !== 'COMPLETED') {
    throw conflict('You can review a session once it has been completed.');
  }
  const partnerId = partnerOf(session, userId);
  if (!partnerId) throw conflict('This session has no partner to review.');

  // Claim the single review slot first; the filter makes a second attempt a no-op.
  const claimed = await Session.updateOne(
    { _id: session._id, reviewedBy: { $ne: user._id } },
    { $addToSet: { reviewedBy: user._id } },
  );
  if (claimed.modifiedCount === 0) throw conflict('You have already reviewed this session.');

  try {
    await Review.create({
      session: session._id,
      contract: session.contract ?? null,
      reviewer: user._id,
      reviewee: partnerId,
      role: session.teacher.toString() === partnerId ? 'TEACHER' : 'STUDENT',
      skill: session.skillTaught,
      rating: input.rating,
      feedback: input.feedback,
    });
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      throw conflict('You have already reviewed this session.');
    }
    await Session.updateOne({ _id: session._id }, { $pull: { reviewedBy: user._id } });
    throw err;
  }

  await recomputeUserStats(partnerId);
  await notify(ctx, {
    recipientId: partnerId,
    senderId: userId,
    type: 'REVIEW_RECEIVED',
    title: 'New review',
    message: `${user.name} rated your session ${input.rating} out of 5.`,
    link: `/profile/${encodeURIComponent((await ownUsername(partnerId)) ?? '')}`,
  });
  return loadDTO(session._id, userId);
}

async function ownUsername(userId: string): Promise<string | null> {
  const user = await User.findById(userId).select('username').lean();
  return user?.username ?? null;
}

/* ---------- Shared files ---------- */

export async function assertCanUpload(user: UserDoc, sessionId: string): Promise<SessionDoc> {
  const session = await loadSessionForParticipant({ _id: sessionId }, user._id.toString());
  if (session.status !== 'SCHEDULED' && session.status !== 'ACTIVE') {
    throw conflict('Files can only be shared while a session is open.');
  }
  if (session.sharedFiles.length >= MAX_FILES_PER_SESSION) {
    throw conflict(`A session can hold at most ${MAX_FILES_PER_SESSION} files.`);
  }
  return session;
}

export async function addFile(
  ctx: AppContext,
  user: UserDoc,
  session: SessionDoc,
  file: { originalName: string; storedName: string; size: number; mimeType: string },
): Promise<SharedFile> {
  session.sharedFiles.push({
    name: file.originalName,
    storedName: file.storedName,
    size: file.size,
    type: file.mimeType,
    uploader: user._id,
    uploadedAt: new Date(),
  } as SessionDoc['sharedFiles'][number]);
  await session.save();
  ctx.realtime.filesChanged(session.roomCode);
  const saved = session.sharedFiles[session.sharedFiles.length - 1];
  if (!saved) throw new Error('file was not stored');
  return toSharedFile(saved);
}

export async function openFile(ctx: AppContext, user: UserDoc, sessionId: string, fileId: string) {
  const session = await loadSessionForParticipant({ _id: sessionId }, user._id.toString());
  const file = session.sharedFiles.find((f) => f._id.toString() === fileId);
  if (!file) throw notFound('File');
  // storedName is generated by the server; basename() is a second guard against path tricks.
  const fullPath = path.join(ctx.env.uploadDir, path.basename(file.storedName));
  return { name: file.name, size: file.size, stream: () => createReadStream(fullPath) };
}

export async function removeFile(
  ctx: AppContext,
  user: UserDoc,
  sessionId: string,
  fileId: string,
): Promise<void> {
  const userId = user._id.toString();
  const session = await loadSessionForParticipant({ _id: sessionId }, userId);
  const file = session.sharedFiles.find((f) => f._id.toString() === fileId);
  if (!file) throw notFound('File');
  if (file.uploader.toString() !== userId) {
    throw forbidden('Only the member who shared a file can remove it.');
  }
  session.sharedFiles = session.sharedFiles.filter((f) => f._id.toString() !== fileId);
  await session.save();
  await unlink(path.join(ctx.env.uploadDir, path.basename(file.storedName))).catch(() => undefined);
  ctx.realtime.filesChanged(session.roomCode);
}
