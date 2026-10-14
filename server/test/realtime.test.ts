import jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  COLLAB,
  type RoomJoinResult,
  type SessionDTO,
  type SessionDetail,
} from '@skillswap/shared';
import { Message, Session, User } from '../src/models';
import { buildDoc, toBytes } from '../src/realtime/rooms';
import {
  type ClientSocket,
  type LiveServer,
  type Member,
  type TestApp,
  acceptedContract,
  connected,
  createTestApp,
  once,
  openSocket,
  schedule,
  signUp,
  sleep,
  startLiveServer,
  tradingPair,
} from './helpers';

let t: TestApp;
let live: LiveServer;
const sockets: ClientSocket[] = [];

beforeAll(async () => {
  t = await createTestApp();
  live = await startLiveServer(t);
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.disconnect();
});
afterAll(async () => {
  await live.close();
  await t.close();
});

async function socketFor(member: Member): Promise<ClientSocket> {
  const socket = openSocket(live, member.cookie);
  sockets.push(socket);
  await connected(socket);
  return socket;
}

const join = (socket: ClientSocket, roomCode: string) =>
  new Promise<RoomJoinResult>((resolve) => socket.emit('room:join', roomCode, resolve));

async function scheduledRoom(): Promise<{ ana: Member; ben: Member; session: SessionDTO }> {
  const { ana, ben } = await tradingPair(t);
  const { contract } = await acceptedContract(ana, ben);
  return { ana, ben, session: await schedule(ana, contract.id) };
}

describe('connection authentication', () => {
  it('refuses sockets without a valid session cookie', async () => {
    const anonymous = openSocket(live, null);
    sockets.push(anonymous);
    await expect(connected(anonymous)).rejects.toThrow(/unauthorized/);

    const admin = await signUp(t);
    await User.updateOne({ _id: admin.user.id }, { role: 'ADMIN' });
    const forged = jwt.sign(
      { sub: admin.user.id, tv: 0 },
      'skillswap_super_secret_jwt_key_2026_xyz',
    );
    const withForged = openSocket(live, `skillswap_session=${forged}`);
    sockets.push(withForged);
    await expect(connected(withForged)).rejects.toThrow(/unauthorized/);
  });

  it('refuses connections initiated by other websites', async () => {
    const member = await signUp(t);
    const crossSite = openSocket(live, member.cookie, { origin: 'https://evil.example' });
    sockets.push(crossSite);
    await expect(connected(crossSite)).rejects.toThrow();
  });

  it('refuses suspended members and drops them when they are suspended while connected', async () => {
    const member = await signUp(t);
    const socket = await socketFor(member);
    const dropped = new Promise<string>((resolve) => socket.once('disconnect', resolve));
    live.realtime.disconnectUser(member.user.id);
    expect(await dropped).toBe('io server disconnect');
  });

  it('tracks presence from the authenticated identity only', async () => {
    const watcher = await socketFor(await signUp(t));
    const member = await signUp(t);
    const cameOnline = once(watcher, 'presence:changed');
    const socket = await socketFor(member);
    expect((await cameOnline)[0]).toEqual({ userId: member.user.id, online: true });
    expect(live.realtime.isOnline(member.user.id)).toBe(true);

    const wentOffline = once(watcher, 'presence:changed');
    socket.disconnect();
    expect((await wentOffline)[0]).toEqual({ userId: member.user.id, online: false });
    expect(live.realtime.isOnline(member.user.id)).toBe(false);
  });
});

describe('session rooms', () => {
  it('only admits the two participants', async () => {
    const { session } = await scheduledRoom();
    const outsider = await socketFor(await signUp(t));
    expect(await join(outsider, session.roomCode)).toMatchObject({ ok: false, code: 'not_found' });
    expect(await join(outsider, 'NO-SUCH-ROOM')).toMatchObject({ ok: false, code: 'not_found' });
    expect(await join(outsider, '{"$ne":null}')).toMatchObject({ ok: false, code: 'not_found' });

    // Not being in the room, the outsider can neither chat into it nor inject signaling or edits.
    const ack = await new Promise((resolve) =>
      outsider.emit('chat:send', { text: 'hello?' }, resolve),
    );
    expect(ack).toMatchObject({ ok: false, code: 'not_in_room' });
    outsider.emit('rtc:signal', { description: { type: 'offer', sdp: 'x' } });
    outsider.emit('doc:update', new Uint8Array([1, 2, 3]));
    await sleep(100);
    expect(await Message.countDocuments({ sessionId: session.roomCode })).toBe(0);
    expect((await Session.findById(session.id).lean())?.status).toBe('SCHEDULED');
  });

  it('starts the session on first join and introduces the two peers with opposite roles', async () => {
    const { ana, ben, session } = await scheduledRoom();
    const a = await socketFor(ana);
    const b = await socketFor(ben);

    const first = await join(a, session.roomCode);
    expect(first).toMatchObject({ ok: true, peers: [], messages: [] });
    const stored = await Session.findById(session.id).lean();
    expect(stored?.status).toBe('ACTIVE');
    expect(stored?.actualStartTime).toBeInstanceOf(Date);

    const announced = once(a, 'room:peer-joined');
    const second = await join(b, session.roomCode);
    expect((await announced)[0].user.id).toBe(ben.user.id);
    if (!first.ok || !second.ok) throw new Error('join failed');
    expect(second.peers.map((p) => p.user.id)).toEqual([ana.user.id]);
    expect(first.polite).not.toBe(second.polite);
    expect((await Session.findById(session.id).lean())?.joinedBy.map(String).sort()).toEqual(
      [ana.user.id, ben.user.id].sort(),
    );

    const left = once(a, 'room:peer-left');
    b.disconnect();
    expect((await left)[0]).toEqual({ userId: ben.user.id });
  });

  it('relays signaling only to the other participant, stamped with the real sender', async () => {
    const { ana, ben, session } = await scheduledRoom();
    const a = await socketFor(ana);
    const b = await socketFor(ben);
    const bystander = await socketFor(await signUp(t));
    await join(a, session.roomCode);
    await join(b, session.roomCode);

    let leaked = false;
    bystander.on('rtc:signal', () => (leaked = true));
    const received = once(b, 'rtc:signal');
    a.emit('rtc:signal', { description: { type: 'offer', sdp: 'v=0' } });
    expect((await received)[0]).toEqual({
      description: { type: 'offer', sdp: 'v=0' },
      fromUserId: ana.user.id,
    });

    // Malformed payloads are dropped instead of being forwarded.
    let forwarded = 0;
    b.on('rtc:signal', () => (forwarded += 1));
    a.emit('rtc:signal', {});
    a.emit('rtc:signal', { description: { type: 'nonsense' } } as never);
    await sleep(150);
    expect(forwarded).toBe(0);
    expect(leaked).toBe(false);
  });

  it('persists chat under the authenticated sender and replays it to late joiners', async () => {
    const { ana, ben, session } = await scheduledRoom();
    const a = await socketFor(ana);
    await join(a, session.roomCode);

    const echoed = once(a, 'chat:message');
    const ack = await new Promise((resolve) =>
      // The extra fields try to impersonate Ben; the server must ignore them.
      a.emit(
        'chat:send',
        { text: '  Hello Ben  ', sender: ben.user.id, userId: ben.user.id } as never,
        resolve,
      ),
    );
    expect(ack).toEqual({ ok: true });
    expect((await echoed)[0]).toMatchObject({ text: 'Hello Ben', sender: { id: ana.user.id } });

    const stored = await Message.find({ sessionId: session.roomCode }).lean();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.sender.toString()).toBe(ana.user.id);

    const tooLong = await new Promise((resolve) =>
      a.emit('chat:send', { text: 'x'.repeat(2001) }, resolve),
    );
    expect(tooLong).toMatchObject({ ok: false, code: 'validation_failed' });

    const b = await socketFor(ben);
    const joined = await join(b, session.roomCode);
    if (!joined.ok) throw new Error('join failed');
    expect(joined.messages.map((m) => m.text)).toEqual(['Hello Ben']);
  });

  it('rate limits chat', async () => {
    const { ana, session } = await scheduledRoom();
    const a = await socketFor(ana);
    await join(a, session.roomCode);
    const results = await Promise.all(
      Array.from(
        { length: 12 },
        (_, i) =>
          new Promise<{ ok: boolean }>((resolve) =>
            a.emit('chat:send', { text: `m${i}` }, resolve),
          ),
      ),
    );
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(9);
    expect(results.some((r) => !r.ok)).toBe(true);
  });

  it('moves the seat to the newest tab of the same member', async () => {
    const { ana, session } = await scheduledRoom();
    const firstTab = await socketFor(ana);
    const secondTab = await socketFor(ana);
    await join(firstTab, session.roomCode);
    const replaced = once(firstTab, 'room:replaced');
    await join(secondTab, session.roomCode);
    await replaced;
    const ack = await new Promise((resolve) =>
      firstTab.emit('chat:send', { text: 'still here?' }, resolve),
    );
    expect(ack).toMatchObject({ ok: false, code: 'not_in_room' });
  });
});

describe('shared document', () => {
  it('merges concurrent edits, saves them, and hands the state to late joiners', async () => {
    const { ana, ben, session } = await scheduledRoom();
    const a = await socketFor(ana);
    const b = await socketFor(ben);
    const joinedA = await join(a, session.roomCode);
    const joinedB = await join(b, session.roomCode);
    if (!joinedA.ok || !joinedB.ok) throw new Error('join failed');

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    Y.applyUpdate(docA, new Uint8Array(joinedA.doc));
    Y.applyUpdate(docB, new Uint8Array(joinedB.doc));
    const wire = (doc: Y.Doc, socket: ClientSocket) => {
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin !== 'remote') socket.emit('doc:update', update);
      });
      socket.on('doc:update', (update) => Y.applyUpdate(doc, new Uint8Array(update), 'remote'));
    };
    wire(docA, a);
    wire(docB, b);

    // Both type at the same position at the same time: neither edit may be lost.
    docA.getText(COLLAB.code).insert(0, 'const a = 1;\n');
    docB.getText(COLLAB.code).insert(0, 'const b = 2;\n');
    docA.getText(COLLAB.notes).insert(0, 'Agenda: collections');
    docB.getMap(COLLAB.meta).set(COLLAB.languageKey, 'python');
    docA.getArray(COLLAB.strokes).push([{ id: 's1', points: [0, 0, 10, 10] }]);
    await sleep(300);

    const codeA = docA.getText(COLLAB.code).toJSON();
    expect(codeA).toBe(docB.getText(COLLAB.code).toJSON());
    expect(codeA).toContain('const a = 1;');
    expect(codeA).toContain('const b = 2;');
    expect(docB.getText(COLLAB.notes).toJSON()).toBe('Agenda: collections');
    expect(docA.getMap(COLLAB.meta).get(COLLAB.languageKey)).toBe('python');
    expect(docB.getArray(COLLAB.strokes).length).toBe(1);

    // Everyone leaves: the document is written to the database.
    a.disconnect();
    b.disconnect();
    await sleep(400);
    const saved = await Session.findById(session.id).select('+collabState').lean();
    expect(saved?.notes).toBe('Agenda: collections');
    expect(saved?.codeEditorState).toMatchObject({ language: 'python', code: codeA });
    // A lean read returns a BSON Binary; the loader must understand both shapes.
    expect(toBytes(saved?.collabState)?.byteLength).toBeGreaterThan(0);
    expect(buildDoc(saved as never).getArray(COLLAB.strokes).length).toBe(1);

    // The REST detail reflects the saved snapshot, and a later joiner gets the full document.
    const detail = (await ana.agent.get(`/api/sessions/room/${session.roomCode}`)).body as {
      session: SessionDetail;
    };
    expect(detail.session.notes).toBe('Agenda: collections');
    const late = await socketFor(ben);
    const rejoined = await join(late, session.roomCode);
    if (!rejoined.ok) throw new Error('rejoin failed');
    const docLate = new Y.Doc();
    Y.applyUpdate(docLate, new Uint8Array(rejoined.doc));
    expect(docLate.getText(COLLAB.code).toJSON()).toBe(codeA);
    expect(docLate.getArray(COLLAB.strokes).length).toBe(1);
  });

  it('ignores malformed and oversized updates without disturbing the room', async () => {
    const { ana, ben, session } = await scheduledRoom();
    const a = await socketFor(ana);
    const b = await socketFor(ben);
    await join(a, session.roomCode);
    await join(b, session.roomCode);
    let relayed = 0;
    b.on('doc:update', () => (relayed += 1));
    a.emit('doc:update', 'not binary' as never);
    a.emit('doc:update', new Uint8Array(300 * 1024));
    a.emit('doc:update', new Uint8Array([255, 255, 255, 255, 255]));
    await sleep(200);
    expect(relayed).toBe(0);
    const ack = await new Promise((resolve) =>
      a.emit('chat:send', { text: 'still working' }, resolve),
    );
    expect(ack).toEqual({ ok: true });
  });

  it('seeds the document from legacy plain-text notes and code', async () => {
    const { ana, session } = await scheduledRoom();
    await Session.updateOne(
      { _id: session.id },
      {
        $set: {
          notes: 'Legacy notes',
          codeEditorState: { language: 'java', code: 'class Main {}' },
        },
      },
    );
    const a = await socketFor(ana);
    const joined = await join(a, session.roomCode);
    if (!joined.ok) throw new Error('join failed');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(joined.doc));
    expect(doc.getText(COLLAB.notes).toJSON()).toBe('Legacy notes');
    expect(doc.getText(COLLAB.code).toJSON()).toBe('class Main {}');
    expect(doc.getMap(COLLAB.meta).get(COLLAB.languageKey)).toBe('java');
  });
});

describe('ending a session over HTTP', () => {
  it('tells both sockets, closes the room and refuses further joins', async () => {
    const { ana, ben, session } = await scheduledRoom();
    const a = await socketFor(ana);
    const b = await socketFor(ben);
    await join(a, session.roomCode);
    await join(b, session.roomCode);

    const endedForB = once(b, 'room:ended');
    const res = await ana.agent.post(`/api/sessions/${session.id}/end`);
    expect(res.status).toBe(200);
    expect((res.body as { session: SessionDTO }).session.status).toBe('COMPLETED');
    expect((await endedForB)[0]).toEqual({ byUserId: ana.user.id, status: 'COMPLETED' });

    expect(await join(b, session.roomCode)).toMatchObject({ ok: false, code: 'session_closed' });
    const ack = await new Promise((resolve) =>
      a.emit('chat:send', { text: 'after the end' }, resolve),
    );
    expect(ack).toMatchObject({ ok: false, code: 'not_in_room' });
  });

  it('pushes notifications to the recipient in real time', async () => {
    const { ana, ben } = await tradingPair(t);
    const b = await socketFor(ben);
    const pushed = once(b, 'notification:new');
    await ana.agent.post('/api/exchanges').send({
      receiverId: ben.user.id,
      teachingSkill: 'Java',
      learningSkill: 'Video Editing',
      message: 'Shall we trade skills?',
      sessions: 2,
      durationMinutes: 60,
    });
    expect((await pushed)[0]).toMatchObject({ type: 'EXCHANGE_REQUEST', read: false });
  });
});
