import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  COLLAB_UPDATE_MAX_BYTES,
  type ChatMessageDTO,
  type MediaState,
  type RoomPeer,
  type SessionStatus,
} from '@skillswap/shared';
import type { AppSocket } from '@/features/realtime/SocketProvider';

export type RoomPhase =
  | { name: 'joining' }
  | { name: 'joined'; polite: boolean }
  | { name: 'error'; code: string; message: string }
  | { name: 'replaced' }
  | { name: 'ended'; status: SessionStatus; byUserId: string };

/** Origin tag for document changes that came from the network, so they are not echoed back. */
export const REMOTE = 'remote';

export interface Room {
  phase: RoomPhase;
  peer: RoomPeer | null;
  /** Increases each time the peer (re)joins, so the call can be set up afresh. */
  peerEpoch: number;
  messages: ChatMessageDTO[];
  peerTyping: boolean;
  /** The shared document: code, notes and whiteboard. Stable for the life of the page. */
  doc: Y.Doc;
  sendMessage: (text: string) => Promise<string | null>;
  setTyping: (typing: boolean) => void;
  sendMediaState: (state: MediaState) => void;
  /** Takes the seat back after another tab replaced this one. */
  rejoin: () => void;
  /** Bumps when the list of shared files changed. */
  filesVersion: number;
}

/**
 * Joins a session room and keeps its state: who else is here, chat, and the shared document.
 * Re-joins automatically after a network drop, merging anything typed while offline.
 */
export function useRoom(socket: AppSocket | null, roomCode: string): Room {
  const [doc] = useState(() => new Y.Doc());
  const [phase, setPhase] = useState<RoomPhase>({ name: 'joining' });
  const [peer, setPeer] = useState<RoomPeer | null>(null);
  const [peerEpoch, setPeerEpoch] = useState(0);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [peerTyping, setPeerTyping] = useState(false);
  const [filesVersion, setFilesVersion] = useState(0);
  const [joinAttempt, setJoinAttempt] = useState(0);
  const closed = useRef(false);

  useEffect(() => {
    if (!socket) return;
    closed.current = false;
    let active = true;

    const join = () => {
      socket.emit('room:join', roomCode, (result) => {
        if (!active) return;
        if (!result.ok) {
          setPhase({ name: 'error', code: result.code, message: result.message });
          return;
        }
        const serverState = new Uint8Array(result.doc);
        Y.applyUpdate(doc, serverState, REMOTE);
        // After a reconnect, send whatever was typed while the connection was down.
        const missing = Y.encodeStateAsUpdate(doc, Y.encodeStateVectorFromUpdate(serverState));
        if (missing.byteLength > 2 && missing.byteLength <= COLLAB_UPDATE_MAX_BYTES) {
          socket.emit('doc:update', missing);
        }
        setMessages(result.messages);
        const other = result.peers[0] ?? null;
        setPeer(other);
        if (other) setPeerEpoch((n) => n + 1);
        setPhase({ name: 'joined', polite: result.polite });
      });
    };

    const onLocalUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE || closed.current) return;
      if (update.byteLength <= COLLAB_UPDATE_MAX_BYTES) socket.emit('doc:update', update);
    };
    doc.on('update', onLocalUpdate);

    socket.on('connect', join);
    socket.on('doc:update', (update) => Y.applyUpdate(doc, new Uint8Array(update), REMOTE));
    socket.on('room:peer-joined', (joined) => {
      setPeer(joined);
      setPeerEpoch((n) => n + 1);
    });
    socket.on('room:peer-left', () => {
      setPeer(null);
      setPeerTyping(false);
    });
    socket.on('media:state', ({ userId, ...media }) => {
      setPeer((current) =>
        current && current.user.id === userId ? { ...current, media } : current,
      );
    });
    socket.on('chat:message', (message) => setMessages((list) => [...list, message]));
    socket.on('chat:typing', ({ isTyping }) => setPeerTyping(isTyping));
    socket.on('files:changed', () => setFilesVersion((n) => n + 1));
    socket.on('room:replaced', () => {
      closed.current = true;
      setPeer(null);
      setPhase({ name: 'replaced' });
    });
    socket.on('room:ended', ({ status, byUserId }) => {
      closed.current = true;
      setPeer(null);
      setPhase({ name: 'ended', status, byUserId });
    });

    if (socket.connected) join();

    return () => {
      active = false;
      doc.off('update', onLocalUpdate);
      socket.off('connect', join);
      socket.off('doc:update');
      socket.off('room:peer-joined');
      socket.off('room:peer-left');
      socket.off('media:state');
      socket.off('chat:message');
      socket.off('chat:typing');
      socket.off('files:changed');
      socket.off('room:replaced');
      socket.off('room:ended');
      socket.emit('room:leave');
    };
  }, [socket, roomCode, doc, joinAttempt]);

  useEffect(() => () => doc.destroy(), [doc]);

  const sendMessage = useCallback(
    (text: string) =>
      new Promise<string | null>((resolve) => {
        if (!socket?.connected) return resolve('You are offline. Your message was not sent.');
        socket.emit('chat:send', { text }, (result) => resolve(result.ok ? null : result.message));
      }),
    [socket],
  );

  const setTyping = useCallback((typing: boolean) => socket?.emit('chat:typing', typing), [socket]);
  const sendMediaState = useCallback(
    (state: MediaState) => socket?.emit('media:state', state),
    [socket],
  );
  const rejoin = useCallback(() => {
    setPhase({ name: 'joining' });
    setJoinAttempt((n) => n + 1);
  }, []);

  return {
    phase,
    peer,
    peerEpoch,
    messages,
    peerTyping,
    doc,
    sendMessage,
    setTyping,
    sendMediaState,
    rejoin,
    filesVersion,
  };
}
