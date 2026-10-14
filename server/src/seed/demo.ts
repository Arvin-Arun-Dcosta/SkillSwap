import { unlink } from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import type { Day, SessionFormat, SkillCategory, TimeSlotId } from '@skillswap/shared';
import type { Logger } from '../config/logger';
import { pairKey } from '../lib/ids';
import {
  ExchangeRequest,
  type ILearningSkill,
  type ITeachingSkill,
  LearningContract,
  Message,
  Notification,
  Report,
  Review,
  Session,
  Skill,
  User,
  type UserDoc,
} from '../models';
import { recomputeUserStats } from '../services/stats';

/** Password shared by every demo account. Demo accounts only exist where the seed script was run. */
export const DEMO_PASSWORD = 'Password123!';
export const DEMO_ROOM_CODE = 'SWAP-DEMO-ROOM';

const SKILLS: [string, SkillCategory][] = [
  ['Java', 'Software & Tech'],
  ['DSA', 'Software & Tech'],
  ['Python', 'Software & Tech'],
  ['React', 'Software & Tech'],
  ['TypeScript', 'Software & Tech'],
  ['Machine Learning', 'Data & AI'],
  ['UI/UX Design', 'Design & Creative'],
  ['Figma', 'Design & Creative'],
  ['Video Editing', 'Video & Animation'],
  ['Finance', 'Business & Finance'],
  ['Public Speaking', 'Personal Development'],
  ['Music Production', 'Music & Audio'],
  ['Spanish', 'Languages & Culture'],
  ['Copywriting', 'Writing & Marketing'],
];

interface DemoUser {
  name: string;
  username: string;
  headline: string;
  bio: string;
  location: string;
  timezone: string;
  teaching: ITeachingSkill[];
  learning: ILearningSkill[];
  days: Day[];
  slots: TimeSlotId[];
  format: SessionFormat[];
  languages: string[];
  role?: 'ADMIN';
}

const DEMO_USERS: DemoUser[] = [
  {
    name: 'Arjun Mehta',
    username: 'arjun',
    headline: 'Backend engineer who enjoys teaching Java and algorithms',
    bio: 'Six years building distributed systems on the JVM. I like explaining why code is shaped the way it is, and I want to get better at making tutorial videos.',
    location: 'Bengaluru, India',
    timezone: 'Asia/Kolkata',
    teaching: [
      {
        skill: 'Java',
        proficiency: 'Expert',
        yearsExperience: 6,
        description: 'Core Java, concurrency, the memory model, Spring Boot.',
      },
      {
        skill: 'DSA',
        proficiency: 'Expert',
        yearsExperience: 5,
        description: 'Graphs, dynamic programming, trees, complexity analysis.',
      },
    ],
    learning: [
      {
        skill: 'Video Editing',
        targetProficiency: 'Intermediate',
        priority: 'High',
        notes: 'Editing coding tutorials in DaVinci Resolve.',
      },
      {
        skill: 'Finance',
        targetProficiency: 'Beginner',
        priority: 'Medium',
        notes: 'Portfolio basics and reading company reports.',
      },
    ],
    days: ['Monday', 'Wednesday', 'Saturday', 'Sunday'],
    slots: ['evening'],
    format: ['Video', 'Project-based'],
    languages: ['English', 'Hindi'],
  },
  {
    name: 'Rahul Verma',
    username: 'rahul',
    headline: 'Video editor learning to code',
    bio: 'Four years editing for YouTube creators. Happy to trade pacing, colour and sound design for a solid grounding in Java.',
    location: 'Mumbai, India',
    timezone: 'Asia/Kolkata',
    teaching: [
      {
        skill: 'Video Editing',
        proficiency: 'Expert',
        yearsExperience: 4,
        description: 'Pacing, colour grading, sound design, DaVinci Resolve and Premiere.',
      },
    ],
    learning: [
      {
        skill: 'Java',
        targetProficiency: 'Intermediate',
        priority: 'High',
        notes: 'Object-oriented basics, then a small backend project.',
      },
      {
        skill: 'DSA',
        targetProficiency: 'Beginner',
        priority: 'Medium',
        notes: 'Enough to follow interview-style problems.',
      },
    ],
    days: ['Wednesday', 'Saturday', 'Sunday'],
    slots: ['evening', 'night'],
    format: ['Video', 'Project-based'],
    languages: ['English', 'Hindi'],
  },
  {
    name: 'Alex Rivera',
    username: 'alex',
    headline: 'Machine learning engineer, curious about design',
    bio: 'I train and ship models for a living and teach Python on the side. I want my side projects to stop looking like spreadsheets.',
    location: 'Austin, USA',
    timezone: 'America/Chicago',
    teaching: [
      {
        skill: 'Python',
        proficiency: 'Expert',
        yearsExperience: 7,
        description: 'Idiomatic Python, testing, packaging, data tooling.',
      },
      {
        skill: 'Machine Learning',
        proficiency: 'Advanced',
        yearsExperience: 4,
        description: 'Classical models, PyTorch basics, evaluation.',
      },
    ],
    learning: [
      {
        skill: 'UI/UX Design',
        targetProficiency: 'Intermediate',
        priority: 'High',
        notes: 'Layout, hierarchy and usability testing.',
      },
      { skill: 'Figma', targetProficiency: 'Beginner', priority: 'Medium', notes: '' },
    ],
    days: ['Tuesday', 'Thursday', 'Saturday'],
    slots: ['morning', 'evening'],
    format: ['Video', 'Chat'],
    languages: ['English', 'Spanish'],
  },
  {
    name: 'Elena Rostova',
    username: 'elena',
    headline: 'Product designer who wants to automate the boring parts',
    bio: 'Design systems, research and prototyping. Learning Python so I can analyse my own usability data.',
    location: 'Berlin, Germany',
    timezone: 'Europe/Berlin',
    teaching: [
      {
        skill: 'UI/UX Design',
        proficiency: 'Expert',
        yearsExperience: 8,
        description: 'Research, information architecture, interaction design.',
      },
      {
        skill: 'Figma',
        proficiency: 'Expert',
        yearsExperience: 5,
        description: 'Components, variables, auto layout, prototyping.',
      },
    ],
    learning: [
      {
        skill: 'Python',
        targetProficiency: 'Intermediate',
        priority: 'High',
        notes: 'Data analysis with pandas.',
      },
      { skill: 'Machine Learning', targetProficiency: 'Beginner', priority: 'Low', notes: '' },
    ],
    days: ['Tuesday', 'Thursday', 'Saturday'],
    slots: ['evening'],
    format: ['Video', 'Chat'],
    languages: ['English', 'German', 'Russian'],
  },
  {
    name: 'Marcus Vale',
    username: 'marcus',
    headline: 'Front-end developer working on stage fright',
    bio: 'I build React apps and review a lot of TypeScript. I freeze when presenting, and I would like to stop.',
    location: 'Lisbon, Portugal',
    timezone: 'Europe/Lisbon',
    teaching: [
      {
        skill: 'React',
        proficiency: 'Expert',
        yearsExperience: 6,
        description: 'Component design, state, performance, testing.',
      },
      {
        skill: 'TypeScript',
        proficiency: 'Advanced',
        yearsExperience: 5,
        description: 'Practical typing for application code.',
      },
    ],
    learning: [
      {
        skill: 'Public Speaking',
        targetProficiency: 'Intermediate',
        priority: 'High',
        notes: 'Conference talks without reading slides.',
      },
      { skill: 'Java', targetProficiency: 'Beginner', priority: 'Low', notes: '' },
    ],
    days: ['Monday', 'Wednesday', 'Friday'],
    slots: ['afternoon', 'evening'],
    format: ['Video'],
    languages: ['English', 'Portuguese'],
  },
  {
    name: 'Demo Admin',
    username: 'admin',
    headline: 'SkillSwap moderation team',
    bio: '',
    location: '',
    timezone: 'UTC',
    teaching: [],
    learning: [],
    days: [],
    slots: [],
    format: ['Video'],
    languages: ['English'],
    role: 'ADMIN',
  },
];

const daysFromNow = (days: number, hour = 18) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
};

export async function isDatabaseEmpty(): Promise<boolean> {
  return (await User.estimatedDocumentCount()) === 0;
}

/** Removes every SkillSwap document. Only the seed script and tests call this. */
export async function clearDatabase(): Promise<void> {
  await Promise.all([
    User.deleteMany({}),
    Skill.deleteMany({}),
    ExchangeRequest.deleteMany({}),
    LearningContract.deleteMany({}),
    Session.deleteMany({}),
    Message.deleteMany({}),
    Notification.deleteMany({}),
    Review.deleteMany({}),
    Report.deleteMany({}),
  ]);
}

/** When the current demo data was created (its oldest demo account), or null if there is none. */
export async function demoDataSeededAt(): Promise<Date | null> {
  const first = await User.findOne({ isDemo: true })
    .sort({ createdAt: 1 })
    .select('createdAt')
    .lean();
  return first?.createdAt ?? null;
}

export type DemoRefreshResult = 'seeded' | 'reset' | 'unchanged';

/**
 * Keeps a public demo usable: seeds an empty database, and when `resetHours` is set, replaces all
 * data (and shared files) with a fresh copy once the demo data is older than that. A database that
 * has members but no demo accounts is never reset, so pointing this at real data cannot wipe it.
 */
export async function refreshDemoData(options: {
  bcryptRounds: number;
  resetHours: number;
  uploadDir: string;
  log?: Logger;
  now?: Date;
}): Promise<DemoRefreshResult> {
  if (await isDatabaseEmpty()) {
    await seedDemoData(options);
    return 'seeded';
  }
  if (options.resetHours <= 0) return 'unchanged';
  const seededAt = await demoDataSeededAt();
  if (seededAt === null) {
    options.log?.warn('DEMO_RESET_HOURS is set but the database has no demo data; not resetting');
    return 'unchanged';
  }
  const ageMs = (options.now ?? new Date()).getTime() - seededAt.getTime();
  if (ageMs < options.resetHours * 3_600_000) return 'unchanged';

  const sessions = await Session.find({ 'sharedFiles.0': { $exists: true } })
    .select('sharedFiles.storedName')
    .lean();
  await clearDatabase();
  await Promise.all(
    sessions
      .flatMap((s) => s.sharedFiles)
      .map((f) =>
        unlink(path.join(options.uploadDir, path.basename(f.storedName))).catch(() => undefined),
      ),
  );
  await seedDemoData(options);
  return 'reset';
}

/**
 * Creates the demo personas and a small, internally consistent history: ratings come from real
 * review documents, and every count on screen can be traced to a stored record.
 */
export async function seedDemoData(options: { bcryptRounds: number; log?: Logger }): Promise<void> {
  await Skill.insertMany(SKILLS.map(([name, category]) => ({ name, category })));

  const password = await bcrypt.hash(DEMO_PASSWORD, options.bcryptRounds);
  const users = new Map<string, UserDoc>();
  for (const demo of DEMO_USERS) {
    const user = await User.create({
      name: demo.name,
      username: demo.username,
      email: `${demo.username}@example.com`,
      password,
      headline: demo.headline,
      bio: demo.bio,
      location: demo.location,
      timezone: demo.timezone,
      skillsTeaching: demo.teaching,
      skillsLearning: demo.learning,
      availability: { days: demo.days, timeSlots: demo.slots, hoursPerWeek: 5 },
      preferences: { format: demo.format, sessionLength: 60, languages: demo.languages },
      role: demo.role ?? 'USER',
      isDemo: true,
      onboardingCompleted: true,
    });
    users.set(demo.username, user);
  }
  const get = (username: string) => {
    const user = users.get(username);
    if (!user) throw new Error(`seed user ${username} missing`);
    return user;
  };
  const arjun = get('arjun');
  const rahul = get('rahul');
  const alex = get('alex');
  const elena = get('elena');
  const marcus = get('marcus');

  // 1. Arjun and Rahul: an accepted exchange with two finished sessions and one coming up.
  const exchangeAR = await ExchangeRequest.create({
    sender: arjun._id,
    receiver: rahul._id,
    teachingSkill: 'Java',
    learningSkill: 'Video Editing',
    message:
      'Hi Rahul! I can take you through Java from the ground up if you can help me edit my tutorials.',
    proposedSessions: 4,
    proposedDurationMinutes: 60,
    learningGoals: [
      'Java classes, interfaces and collections',
      'Edit one tutorial start to finish in DaVinci Resolve',
      'Build a small REST service together',
    ],
    status: 'ACCEPTED',
    statusHistory: [
      {
        status: 'PENDING',
        changedBy: arjun._id,
        note: 'Proposal sent',
        timestamp: daysFromNow(-21),
      },
      {
        status: 'ACCEPTED',
        changedBy: rahul._id,
        note: 'Offer accepted',
        timestamp: daysFromNow(-20),
      },
    ],
    openPairKey: pairKey(arjun._id.toString(), rahul._id.toString()),
  });
  const contractAR = await LearningContract.create({
    exchangeRequest: exchangeAR._id,
    userA: arjun._id,
    userB: rahul._id,
    skillA: 'Java',
    skillB: 'Video Editing',
    totalSessions: 4,
    completedSessions: 2,
    sessionDurationMinutes: 60,
    schedule: 'Weekend evenings',
    goals: [
      {
        title: 'Java classes, interfaces and collections',
        completed: true,
        completedAt: daysFromNow(-7),
        completedBy: rahul._id,
      },
      { title: 'Edit one tutorial start to finish in DaVinci Resolve', completed: false },
      { title: 'Build a small REST service together', completed: false },
    ],
    startDate: daysFromNow(-20),
  });
  exchangeAR.createdContract = contractAR._id;
  await exchangeAR.save();

  const finished = async (
    title: string,
    skill: string,
    teacher: UserDoc,
    learner: UserDoc,
    daysAgo: number,
    roomCode: string,
    reviews: { by: UserDoc; rating: number; feedback: string }[],
    contractId = contractAR._id,
  ) => {
    const start = daysFromNow(-daysAgo);
    const session = await Session.create({
      title,
      contract: contractId,
      participants: [teacher._id, learner._id],
      teacher: teacher._id,
      learner: learner._id,
      skillTaught: skill,
      scheduledStartTime: start,
      scheduledEndTime: new Date(start.getTime() + 60 * 60_000),
      actualStartTime: start,
      actualEndTime: new Date(start.getTime() + 58 * 60_000),
      durationMinutes: 60,
      status: 'COMPLETED',
      roomCode,
      notes: `Notes from "${title}"\n\n- What we covered\n- What to practise before next time\n`,
      joinedBy: [teacher._id, learner._id],
      reviewedBy: reviews.map((r) => r.by._id),
      endedBy: teacher._id,
    });
    for (const review of reviews) {
      const reviewee = review.by._id.equals(teacher._id) ? learner : teacher;
      await Review.create({
        session: session._id,
        contract: contractId,
        reviewer: review.by._id,
        reviewee: reviewee._id,
        role: reviewee._id.equals(teacher._id) ? 'TEACHER' : 'STUDENT',
        skill,
        rating: review.rating,
        feedback: review.feedback,
        createdAt: new Date(start.getTime() + 2 * 60 * 60_000),
      });
    }
    return session;
  };

  await finished(
    'Java basics: classes and objects',
    'Java',
    arjun,
    rahul,
    14,
    'SWAP-SEED-0001-JAVA',
    [
      {
        by: rahul,
        rating: 5,
        feedback: 'Clear, patient, and the examples were tied to things I already know.',
      },
      { by: arjun, rating: 5, feedback: 'Came prepared and asked good questions.' },
    ],
  );
  await finished(
    'Editing a tutorial: cuts and pacing',
    'Video Editing',
    rahul,
    arjun,
    7,
    'SWAP-SEED-0002-EDIT',
    [
      {
        by: arjun,
        rating: 5,
        feedback: 'I finally understand why my cuts felt slow. Very hands-on.',
      },
      { by: rahul, rating: 4, feedback: 'Picked things up quickly. Practise the shortcuts!' },
    ],
  );

  const upcomingStart = daysFromNow(1, 19);
  await Session.create({
    title: 'Java collections and generics',
    description: 'Lists, maps and sets, then a short exercise.',
    contract: contractAR._id,
    participants: [arjun._id, rahul._id],
    teacher: arjun._id,
    learner: rahul._id,
    skillTaught: 'Java',
    scheduledStartTime: upcomingStart,
    scheduledEndTime: new Date(upcomingStart.getTime() + 60 * 60_000),
    durationMinutes: 60,
    status: 'SCHEDULED',
    roomCode: DEMO_ROOM_CODE,
    notes:
      'Agenda\n\n1. Recap: classes and interfaces\n2. List, Map, Set\n3. Exercise: word counter\n',
    codeEditorState: {
      language: 'javascript',
      code: '// Shared editor: both of you can type here.\n// JavaScript can be run with the Run button.\n\nfunction wordCount(text) {\n  const counts = new Map();\n  for (const word of text.toLowerCase().split(/\\s+/)) {\n    counts.set(word, (counts.get(word) ?? 0) + 1);\n  }\n  return Object.fromEntries(counts);\n}\n\nconsole.log(wordCount("swap skills swap ideas"));\n',
    },
  });

  // 2. Alex and Elena: a completed two-session exchange.
  const exchangeAE = await ExchangeRequest.create({
    sender: alex._id,
    receiver: elena._id,
    teachingSkill: 'Python',
    learningSkill: 'UI/UX Design',
    message:
      'I can get you productive with pandas quickly. Could you critique my app layouts in return?',
    proposedSessions: 2,
    proposedDurationMinutes: 60,
    learningGoals: ['Load and clean a CSV with pandas', 'Redesign one screen of my side project'],
    status: 'COMPLETED',
    statusHistory: [
      {
        status: 'PENDING',
        changedBy: alex._id,
        note: 'Proposal sent',
        timestamp: daysFromNow(-40),
      },
      {
        status: 'ACCEPTED',
        changedBy: elena._id,
        note: 'Offer accepted',
        timestamp: daysFromNow(-39),
      },
      {
        status: 'COMPLETED',
        changedBy: null,
        note: 'All sessions completed',
        timestamp: daysFromNow(-25),
      },
    ],
  });
  const contractAE = await LearningContract.create({
    exchangeRequest: exchangeAE._id,
    userA: alex._id,
    userB: elena._id,
    skillA: 'Python',
    skillB: 'UI/UX Design',
    totalSessions: 2,
    completedSessions: 2,
    sessionDurationMinutes: 60,
    goals: [
      {
        title: 'Load and clean a CSV with pandas',
        completed: true,
        completedAt: daysFromNow(-32),
        completedBy: elena._id,
      },
      {
        title: 'Redesign one screen of my side project',
        completed: true,
        completedAt: daysFromNow(-25),
        completedBy: alex._id,
      },
    ],
    startDate: daysFromNow(-39),
    endedAt: daysFromNow(-25),
    status: 'COMPLETED',
  });
  exchangeAE.createdContract = contractAE._id;
  await exchangeAE.save();
  await finished(
    'pandas for survey data',
    'Python',
    alex,
    elena,
    32,
    'SWAP-SEED-0003-PYTH',
    [
      {
        by: elena,
        rating: 5,
        feedback: 'Went at my pace and used my own research data. Exactly what I needed.',
      },
      { by: alex, rating: 5, feedback: 'Great questions, and she had the dataset ready.' },
    ],
    contractAE._id,
  );
  await finished(
    'Layout critique: dashboard screen',
    'UI/UX Design',
    elena,
    alex,
    25,
    'SWAP-SEED-0004-UXUI',
    [
      {
        by: alex,
        rating: 5,
        feedback: 'Honest, specific feedback. My dashboard is half the size and twice as clear.',
      },
      { by: elena, rating: 4, feedback: 'Open to critique and iterated live.' },
    ],
    contractAE._id,
  );

  // 3. Open negotiations so the inbox has something in every state.
  await ExchangeRequest.create({
    sender: marcus._id,
    receiver: arjun._id,
    teachingSkill: 'React',
    learningSkill: 'Java',
    message:
      'I would like to understand Java well enough to read our backend. I can teach React in return.',
    proposedSessions: 4,
    proposedDurationMinutes: 45,
    learningGoals: ['Read and run a Spring Boot service', 'Build a typed React form'],
    status: 'PENDING',
    statusHistory: [
      {
        status: 'PENDING',
        changedBy: marcus._id,
        note: 'Proposal sent',
        timestamp: daysFromNow(-1),
      },
    ],
    openPairKey: pairKey(marcus._id.toString(), arjun._id.toString()),
  });
  await ExchangeRequest.create({
    sender: elena._id,
    receiver: marcus._id,
    teachingSkill: 'Figma',
    learningSkill: 'React',
    message: 'I want to prototype in code. Happy to trade a Figma deep dive.',
    proposedSessions: 6,
    proposedDurationMinutes: 60,
    learningGoals: [],
    status: 'COUNTERED',
    counterOffer: {
      sessions: 4,
      durationMinutes: 45,
      schedule: 'Wednesday afternoons',
      goals: [],
      message: 'Six is a lot for me right now. Could we start with four shorter ones?',
      counteredBy: marcus._id,
      counteredAt: daysFromNow(-2),
    },
    statusHistory: [
      {
        status: 'PENDING',
        changedBy: elena._id,
        note: 'Proposal sent',
        timestamp: daysFromNow(-3),
      },
      {
        status: 'COUNTERED',
        changedBy: marcus._id,
        note: 'Counter-offer: 4 × 45 min',
        timestamp: daysFromNow(-2),
      },
    ],
    openPairKey: pairKey(elena._id.toString(), marcus._id.toString()),
  });

  await Notification.insertMany([
    {
      recipient: arjun._id,
      sender: marcus._id,
      type: 'EXCHANGE_REQUEST',
      title: 'New exchange proposal',
      message: 'Marcus Vale offers React in exchange for Java.',
      link: '/exchanges',
    },
    {
      recipient: elena._id,
      sender: marcus._id,
      type: 'COUNTER_OFFER',
      title: 'Counter-offer received',
      message: 'Marcus Vale suggested 4 sessions of 45 minutes.',
      link: '/exchanges',
    },
    {
      recipient: rahul._id,
      sender: arjun._id,
      type: 'UPCOMING_SESSION',
      title: 'Session scheduled',
      message: 'Arjun Mehta scheduled "Java collections and generics".',
      link: '/sessions',
    },
  ]);

  await Report.create({
    reporter: elena._id,
    reportedUser: marcus._id,
    reason: 'No-show / Abandoned Session',
    details: 'Example report for the moderation queue: we agreed a time by chat and nobody joined.',
  });

  await Promise.all([...users.values()].map((u) => recomputeUserStats(u._id.toString())));
  options.log?.info({ users: users.size }, 'demo data seeded');
}
