import * as Y from 'yjs';
import {
  COLLAB,
  EDITOR_LANGUAGE_IDS,
  type EditorLanguage,
  LIMITS,
  type RoomPeer,
} from '@skillswap/shared';
import type { Logger } from '../config/logger';
import { Session, type SessionDoc } from '../models';

export interface Room {
  code: string;
  sessionId: string;
  doc: Y.Doc;
  /** One connection per member; a second tab replaces the first. */
  members: Map<string, { socketId: string; peer: RoomPeer }>;
  dirty: boolean;
  saveTimer: NodeJS.Timeout | null;
}

const SAVE_DEBOUNCE_MS = 2000;
const TEXT_SNAPSHOT_MAX = 200_000;

/**
 * Normalises a stored binary value. Hydrated documents yield a Buffer, but lean queries yield a
 * BSON Binary whose `length` is a method, so the two must not be treated alike.
 */
export function toBytes(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === 'object' && 'buffer' in value && value.buffer instanceof Uint8Array) {
    const position = (value as { position?: number }).position;
    return new Uint8Array(
      typeof position === 'number' ? value.buffer.subarray(0, position) : value.buffer,
    );
  }
  return null;
}

/** Builds the shared document for a session from its saved state, or from legacy plain text. */
export function buildDoc(
  session: Pick<SessionDoc, 'collabState' | 'notes' | 'codeEditorState'>,
): Y.Doc {
  const doc = new Y.Doc();
  const saved = toBytes(session.collabState);
  if (saved && saved.byteLength > 0) {
    Y.applyUpdate(doc, saved);
    return doc;
  }
  doc.transact(() => {
    if (session.codeEditorState?.code)
      doc.getText(COLLAB.code).insert(0, session.codeEditorState.code);
    if (session.notes) doc.getText(COLLAB.notes).insert(0, session.notes);
    doc
      .getMap(COLLAB.meta)
      .set(COLLAB.languageKey, session.codeEditorState?.language ?? 'javascript');
  });
  return doc;
}

export function docLanguage(doc: Y.Doc): EditorLanguage {
  const value = doc.getMap(COLLAB.meta).get(COLLAB.languageKey);
  return (EDITOR_LANGUAGE_IDS as readonly unknown[]).includes(value)
    ? (value as EditorLanguage)
    : 'javascript';
}

/** Holds the live document of every open room and writes it back to MongoDB. */
export class RoomStore {
  private readonly rooms = new Map<string, Room>();
  private readonly loading = new Map<string, Promise<Room>>();

  constructor(private readonly log: Logger) {}

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** Returns the open room for a session, loading its document once even under concurrent joins. */
  async open(session: SessionDoc): Promise<Room> {
    const existing = this.rooms.get(session.roomCode);
    if (existing) return existing;
    const pending = this.loading.get(session.roomCode);
    if (pending) return pending;

    const load = (async () => {
      const withState = await Session.findById(session._id).select(
        '+collabState notes codeEditorState',
      );
      const room: Room = {
        code: session.roomCode,
        sessionId: session._id.toString(),
        doc: buildDoc(withState ?? session),
        members: new Map(),
        dirty: false,
        saveTimer: null,
      };
      this.rooms.set(room.code, room);
      return room;
    })();
    this.loading.set(session.roomCode, load);
    try {
      return await load;
    } finally {
      this.loading.delete(session.roomCode);
    }
  }

  markDirty(room: Room): void {
    room.dirty = true;
    room.saveTimer ??= setTimeout(() => {
      room.saveTimer = null;
      void this.persist(room);
    }, SAVE_DEBOUNCE_MS);
  }

  async persist(room: Room): Promise<void> {
    if (room.saveTimer) {
      clearTimeout(room.saveTimer);
      room.saveTimer = null;
    }
    if (!room.dirty) return;
    room.dirty = false;
    try {
      const state = Y.encodeStateAsUpdate(room.doc);
      if (state.byteLength > LIMITS.collabDocMaxBytes) {
        this.log.warn(
          { roomCode: room.code, bytes: state.byteLength },
          'shared document exceeds the size cap; not persisted',
        );
        return;
      }
      await Session.updateOne(
        { _id: room.sessionId },
        {
          $set: {
            collabState: Buffer.from(state),
            notes: room.doc.getText(COLLAB.notes).toJSON().slice(0, TEXT_SNAPSHOT_MAX),
            codeEditorState: {
              language: docLanguage(room.doc),
              code: room.doc.getText(COLLAB.code).toJSON().slice(0, TEXT_SNAPSHOT_MAX),
            },
          },
        },
      );
    } catch (err) {
      room.dirty = true;
      this.log.error({ err, roomCode: room.code }, 'could not persist shared document');
    }
  }

  /** Saves and unloads a room. Called when the last member leaves or the session ends. */
  async close(code: string): Promise<void> {
    const room = this.rooms.get(code);
    if (!room) return;
    await this.persist(room);
    this.rooms.delete(code);
    room.doc.destroy();
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.rooms.keys()].map((code) => this.close(code)));
  }
}

/** Allows `capacity` events per `perMs`, refilling continuously. */
export function createTokenBucket(capacity: number, perMs: number) {
  let tokens = capacity;
  let last = Date.now();
  return (): boolean => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / perMs) * capacity);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}
