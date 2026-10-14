import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Session, User } from '../src/models';
import { clearDatabase, demoDataSeededAt, refreshDemoData } from '../src/seed/demo';
import { type TestApp, createTestApp, signUp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => clearDatabase());

const HOUR = 3_600_000;
const refresh = (resetHours: number, hoursFromNow = 0) =>
  refreshDemoData({
    bcryptRounds: 4,
    resetHours,
    uploadDir: t.uploadDir,
    now: new Date(Date.now() + hoursFromNow * HOUR),
  });

describe('keeping a public demo fresh', () => {
  it('seeds an empty database and leaves it alone afterwards', async () => {
    expect(await refresh(0)).toBe('seeded');
    expect(await User.countDocuments({ isDemo: true })).toBeGreaterThan(0);
    expect(await refresh(0, 1000)).toBe('unchanged');
  });

  it('does not reset demo data younger than the reset interval', async () => {
    await refresh(24);
    expect(await refresh(24, 23)).toBe('unchanged');
  });

  it('replaces everything visitors changed once the demo data is old enough', async () => {
    await refresh(24);
    const seededAt = await demoDataSeededAt();
    await User.updateOne({ username: 'rahul' }, { bio: 'vandalised', status: 'SUSPENDED' });
    const visitor = await signUp(t);
    const session = await Session.findOne({ roomCode: 'SWAP-DEMO-ROOM' });
    const storedName = 'visitor-upload.txt';
    writeFileSync(path.join(t.uploadDir, storedName), 'shared');
    await Session.updateOne(
      { _id: session?._id },
      {
        $push: {
          sharedFiles: { name: 'a.txt', storedName, uploader: session?.participants[0] },
        },
      },
    );

    expect(await refresh(24, 25)).toBe('reset');

    const rahul = await User.findOne({ username: 'rahul' }).lean();
    expect(rahul?.bio).not.toBe('vandalised');
    expect(rahul?.status).toBe('ACTIVE');
    expect(await User.exists({ _id: visitor.user.id })).toBeNull();
    expect(existsSync(path.join(t.uploadDir, storedName))).toBe(false);
    expect((await demoDataSeededAt())?.getTime()).toBeGreaterThan(seededAt?.getTime() ?? 0);
  });

  it('never resets a database that holds members but no demo data', async () => {
    const member = await signUp(t);
    expect(await refresh(1, 1000)).toBe('unchanged');
    expect(await User.exists({ _id: member.user.id })).not.toBeNull();
  });
});
