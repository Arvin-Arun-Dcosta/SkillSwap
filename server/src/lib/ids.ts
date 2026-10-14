import { randomBytes, randomInt } from 'node:crypto';
import mongoose from 'mongoose';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** An unguessable room code such as `SWAP-7KQ2-M9XD-4TBH` (about 60 bits of entropy). */
export function generateRoomCode(): string {
  const group = () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `SWAP-${group()}-${group()}-${group()}`;
}

export function generateStoredFileName(extension: string): string {
  return `${randomBytes(16).toString('hex')}.${extension}`;
}

export function isObjectId(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}

export function toObjectId(value: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(value);
}

/** Order-independent key for a pair of members. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}
