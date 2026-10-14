import type { NotificationDTO, SessionStatus } from '@skillswap/shared';
import type { Env } from './config/env';
import type { Logger } from './config/logger';

/** The parts of the real-time layer that request handlers are allowed to use. */
export interface RealtimeHub {
  isOnline(userId: string): boolean;
  onlineUserIds(): string[];
  pushNotification(userId: string, notification: NotificationDTO): void;
  /** Saves the shared document, tells both participants the session ended and closes the room. */
  endRoom(roomCode: string, payload: { byUserId: string; status: SessionStatus }): Promise<void>;
  filesChanged(roomCode: string): void;
  /** Drops every connection of a member, for example after a suspension. */
  disconnectUser(userId: string): void;
}

export interface AppContext {
  env: Env;
  log: Logger;
  realtime: RealtimeHub;
}

/** Used until the socket server is attached, and by tests that do not need real-time behaviour. */
export const noopRealtime: RealtimeHub = {
  isOnline: () => false,
  onlineUserIds: () => [],
  pushNotification: () => undefined,
  endRoom: () => Promise.resolve(),
  filesChanged: () => undefined,
  disconnectUser: () => undefined,
};
