import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import * as Y from 'yjs';
import {
  COLLAB_UPDATE_MAX_BYTES,
  type ClientToServerEvents,
  type MediaState,
  type RoomPeer,
  type ServerToClientEvents,
  type UserSummary,
  chatMessageSchema,
  roomCodeSchema,
  signalSchema,
} from '@skillswap/shared';
import type { Env } from '../config/env';
import type { Logger } from '../config/logger';
import type { AppContext, RealtimeHub } from '../context';
import { cookieName, readCookie } from '../lib/session-token';
import { resolveUser } from '../middleware/auth';
import { allowedOrigins } from '../middleware/security';
import { type IUser, Message, Session } from '../models';
import { toChatMessage, toSummary } from '../serializers';
import { RoomStore, createTokenBucket } from './rooms';

interface SocketData {
  user: UserSummary;
  roomCode: string | null;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const roomChannel = (code: string) => `room:${code}`;
const userChannel = (userId: string) => `user:${userId}`;
const HISTORY_LIMIT = 100;

export interface Realtime extends RealtimeHub {
  io: IO;
  /** Saves every open document and closes all connections. */
  shutdown(): Promise<void>;
}

/** Accepts same-host connections and the configured client origins; rejects other websites. */
function originAllowed(env: Env, origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  if (allowedOrigins(env).has(origin)) return true;
  try {
    return host !== undefined && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function createRealtime(deps: { env: Env; log: Logger }, httpServer: HttpServer): Realtime {
  const { env } = deps;
  const log = deps.log.child({ component: 'realtime' });
  const rooms = new RoomStore(log);
  /** userId → ids of that member's open sockets. */
  const presence = new Map<string, Set<string>>();

  const io: IO = new Server(httpServer, {
    cors: { origin: env.clientOrigins, credentials: true },
    maxHttpBufferSize: 1024 * 1024,
    allowRequest: (req, callback) => {
      callback(null, originAllowed(env, req.headers.origin, req.headers.host));
    },
  });

  // Every connection must present a valid session cookie. Identity comes from it and nowhere else.
  const authContext = { env, log, realtime: undefined as never } as AppContext;
  io.use((socket, next) => {
    const token = readCookie(socket.handshake.headers.cookie, cookieName(env));
    resolveUser(authContext, token)
      .then((user) => {
        if (!user || user.status !== 'ACTIVE') return next(new Error('unauthorized'));
        socket.data.user = toSummary(user);
        socket.data.roomCode = null;
        next();
      })
      .catch((err: unknown) => {
        log.error({ err }, 'socket authentication failed');
        next(new Error('unauthorized'));
      });
  });

  async function leaveRoom(socket: AppSocket): Promise<void> {
    const code = socket.data.roomCode;
    if (!code) return;
    socket.data.roomCode = null;
    await socket.leave(roomChannel(code));
    const room = rooms.get(code);
    if (!room) return;
    const userId = socket.data.user.id;
    // A newer tab of the same member may already own the seat; only the owner vacates it.
    if (room.members.get(userId)?.socketId === socket.id) {
      room.members.delete(userId);
      socket.to(roomChannel(code)).emit('room:peer-left', { userId });
    }
    if (room.members.size === 0) await rooms.close(code);
  }

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const userId = user.id;

    void socket.join(userChannel(userId));
    const sockets = presence.get(userId) ?? new Set<string>();
    const wasOffline = sockets.size === 0;
    sockets.add(socket.id);
    presence.set(userId, sockets);
    socket.emit('presence:sync', [...presence.keys()]);
    if (wasOffline) socket.broadcast.emit('presence:changed', { userId, online: true });

    const chatBudget = createTokenBucket(8, 4000);
    const updateBudget = createTokenBucket(120, 1000);
    const signalBudget = createTokenBucket(200, 1000);

    socket.on('room:join', (rawCode, ack) => {
      if (typeof ack !== 'function') return;
      void (async () => {
        const parsed = roomCodeSchema.safeParse(rawCode);
        const session = parsed.success ? await Session.findOne({ roomCode: parsed.data }) : null;
        // Non-participants get the same answer as for a room that does not exist.
        if (!session || !session.participants.some((p) => p.toString() === userId)) {
          return ack({ ok: false, code: 'not_found', message: 'This session does not exist.' });
        }
        if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
          return ack({
            ok: false,
            code: 'session_closed',
            message: `This session is ${session.status.toLowerCase()}.`,
          });
        }

        await leaveRoom(socket);
        const room = await rooms.open(session);

        await Session.updateOne(
          { _id: session._id },
          { $addToSet: { joinedBy: session.participants.find((p) => p.toString() === userId) } },
        );
        await Session.updateOne(
          { _id: session._id, status: 'SCHEDULED' },
          { $set: { status: 'ACTIVE', actualStartTime: new Date() } },
        );

        const previous = room.members.get(userId);
        if (previous && previous.socketId !== socket.id) {
          const old = io.sockets.sockets.get(previous.socketId);
          if (old) {
            old.data.roomCode = null;
            await old.leave(roomChannel(room.code));
            old.emit('room:replaced');
          }
        }

        const peer: RoomPeer = { user, media: { audio: false, video: false, screen: false } };
        room.members.set(userId, { socketId: socket.id, peer });
        socket.data.roomCode = room.code;
        await socket.join(roomChannel(room.code));
        socket.to(roomChannel(room.code)).emit('room:peer-joined', peer);

        const history = await Message.find({ sessionId: room.code })
          .populate<{ sender: IUser | null }>('sender', 'name username avatar headline')
          .sort({ createdAt: -1 })
          .limit(HISTORY_LIMIT)
          .lean();

        const partnerId = session.participants.find((p) => p.toString() !== userId)?.toString();
        ack({
          ok: true,
          peers: [...room.members.values()]
            .filter((m) => m.peer.user.id !== userId)
            .map((m) => m.peer),
          messages: history.reverse().map(toChatMessage),
          doc: Y.encodeStateAsUpdate(room.doc),
          // The two sides must disagree on this flag; ids give a stable tie-break.
          polite: partnerId !== undefined && userId < partnerId,
        });
      })().catch((err: unknown) => {
        log.error({ err, userId }, 'room:join failed');
        ack({ ok: false, code: 'internal_error', message: 'Could not join the session.' });
      });
    });

    socket.on('room:leave', () => {
      void leaveRoom(socket).catch((err: unknown) => log.error({ err }, 'room:leave failed'));
    });

    /** The room this socket currently holds a seat in, if any. */
    const seat = () => {
      const code = socket.data.roomCode;
      const room = code ? rooms.get(code) : undefined;
      return room && room.members.get(userId)?.socketId === socket.id ? room : undefined;
    };

    socket.on('rtc:signal', (payload) => {
      const room = seat();
      if (!room || !signalBudget()) return;
      const parsed = signalSchema.safeParse(payload);
      if (!parsed.success) return;
      socket.to(roomChannel(room.code)).emit('rtc:signal', { ...parsed.data, fromUserId: userId });
    });

    socket.on('media:state', (state: MediaState) => {
      const room = seat();
      const member = room?.members.get(userId);
      if (!room || !member || typeof state !== 'object' || state === null) return;
      member.peer.media = {
        audio: state.audio === true,
        video: state.video === true,
        screen: state.screen === true,
      };
      socket.to(roomChannel(room.code)).emit('media:state', { ...member.peer.media, userId });
    });

    socket.on('chat:send', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      const room = seat();
      if (!room)
        return reply({ ok: false, code: 'not_in_room', message: 'Join the session first.' });
      if (!chatBudget()) {
        return reply({
          ok: false,
          code: 'rate_limited',
          message: 'You are sending messages too quickly.',
        });
      }
      const parsed = chatMessageSchema.safeParse(payload);
      if (!parsed.success) {
        return reply({
          ok: false,
          code: 'validation_failed',
          message: 'Messages can be up to 2,000 characters.',
        });
      }
      void (async () => {
        const created = await Message.create({
          sessionId: room.code,
          sender: userId,
          text: parsed.data.text,
        });
        io.to(roomChannel(room.code)).emit('chat:message', {
          id: created._id.toString(),
          sender: user,
          text: created.text,
          createdAt: created.createdAt.toISOString(),
        });
        reply({ ok: true });
      })().catch((err: unknown) => {
        log.error({ err }, 'chat:send failed');
        reply({ ok: false, code: 'internal_error', message: 'Your message could not be sent.' });
      });
    });

    socket.on('chat:typing', (isTyping) => {
      const room = seat();
      if (!room) return;
      socket
        .to(roomChannel(room.code))
        .emit('chat:typing', { userId, isTyping: isTyping === true });
    });

    socket.on('doc:update', (update) => {
      const room = seat();
      if (!room || !updateBudget()) return;
      if (!(update instanceof Uint8Array) || update.byteLength === 0) return;
      if (update.byteLength > COLLAB_UPDATE_MAX_BYTES) return;
      try {
        Y.applyUpdate(room.doc, update, socket.id);
      } catch (err) {
        log.warn({ err, userId }, 'rejected malformed document update');
        return;
      }
      rooms.markDirty(room);
      socket.to(roomChannel(room.code)).emit('doc:update', update);
    });

    socket.on('disconnect', () => {
      void leaveRoom(socket).catch((err: unknown) =>
        log.error({ err }, 'leave on disconnect failed'),
      );
      const mine = presence.get(userId);
      if (!mine) return;
      mine.delete(socket.id);
      if (mine.size === 0) {
        presence.delete(userId);
        socket.broadcast.emit('presence:changed', { userId, online: false });
      }
    });
  });

  return {
    io,
    isOnline: (userId) => presence.has(userId),
    onlineUserIds: () => [...presence.keys()],
    pushNotification: (userId, notification) => {
      io.to(userChannel(userId)).emit('notification:new', notification);
    },
    endRoom: async (roomCode, payload) => {
      io.to(roomChannel(roomCode)).emit('room:ended', payload);
      const room = rooms.get(roomCode);
      if (room) {
        for (const member of room.members.values()) {
          const s = io.sockets.sockets.get(member.socketId);
          if (s) s.data.roomCode = null;
        }
      }
      io.in(roomChannel(roomCode)).socketsLeave(roomChannel(roomCode));
      await rooms.close(roomCode);
    },
    filesChanged: (roomCode) => {
      io.to(roomChannel(roomCode)).emit('files:changed');
    },
    disconnectUser: (userId) => {
      io.in(userChannel(userId)).disconnectSockets(true);
    },
    shutdown: async () => {
      await rooms.closeAll();
      await io.close();
    },
  };
}
