import bcrypt from 'bcryptjs';
import type {
  ChangePasswordInput,
  DemoAccount,
  LoginInput,
  ProfileUpdateInput,
  RegisterInput,
} from '@skillswap/shared';
import type { AppContext } from '../context';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { User, type UserDoc } from '../models';

/** A valid hash of a random string, compared against when the account does not exist. */
let decoyHash: string | null = null;
async function getDecoyHash(rounds: number): Promise<string> {
  decoyHash ??= await bcrypt.hash(crypto.randomUUID(), rounds);
  return decoyHash;
}

const INVALID_CREDENTIALS = () =>
  new AppError(401, 'invalid_credentials', 'That email, username or password is incorrect.');

export async function hashPassword(ctx: AppContext, password: string): Promise<string> {
  return bcrypt.hash(password, ctx.env.bcryptRounds);
}

export async function register(ctx: AppContext, input: RegisterInput): Promise<UserDoc> {
  const existing = await User.findOne({
    $or: [{ email: input.email }, { username: input.username }],
  })
    .select('email username')
    .lean();
  if (existing) {
    throw conflict(
      'An account with those details already exists.',
      existing.email === input.email
        ? { email: 'This email is already registered.' }
        : { username: 'This username is taken.' },
    );
  }
  try {
    return await User.create({
      name: input.name,
      username: input.username,
      email: input.email,
      password: await hashPassword(ctx, input.password),
    });
  } catch (err) {
    // Two sign-ups racing for the same email or username: the unique index decides.
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      throw conflict('An account with those details already exists.');
    }
    throw err;
  }
}

export async function login(ctx: AppContext, input: LoginInput): Promise<UserDoc> {
  const identifier = input.identifier.toLowerCase();
  const user = await User.findOne({
    $or: [{ email: identifier }, { username: identifier }],
  }).select('+password');

  // Always run one comparison so response time does not reveal whether the account exists.
  const hash = user?.password ?? (await getDecoyHash(ctx.env.bcryptRounds));
  const matches = await bcrypt.compare(input.password, hash);
  if (!user || !matches) throw INVALID_CREDENTIALS();
  if (user.status === 'SUSPENDED') {
    throw new AppError(403, 'account_suspended', 'This account has been suspended.');
  }
  user.lastActive = new Date();
  await user.save();
  return user;
}

/**
 * One-click sign-in for showcase accounts. It only exists while demo mode is on and only works for
 * accounts the seed script flagged as demo accounts, so it can never open a real member's account.
 */
export async function demoLogin(ctx: AppContext, username: string): Promise<UserDoc> {
  if (!ctx.env.demoMode) throw notFound('Route');
  const user = await User.findOne({ username, isDemo: true });
  if (!user) throw notFound('Demo account');
  if (user.status === 'SUSPENDED') {
    throw new AppError(403, 'account_suspended', 'This account has been suspended.');
  }
  user.lastActive = new Date();
  await user.save();
  return user;
}

export async function listDemoAccounts(ctx: AppContext): Promise<DemoAccount[]> {
  if (!ctx.env.demoMode) return [];
  const users = await User.find({ isDemo: true, status: 'ACTIVE' })
    .select('username name role skillsTeaching skillsLearning')
    .sort({ role: -1, createdAt: 1 })
    .limit(8)
    .lean();
  return users.map((u) => ({
    username: u.username,
    name: u.name,
    role: u.role,
    blurb:
      u.role === 'ADMIN'
        ? 'Moderation and analytics'
        : `Teaches ${u.skillsTeaching[0]?.skill ?? 'various skills'}, wants ${u.skillsLearning[0]?.skill ?? 'to learn'}`,
  }));
}

export async function updateProfile(user: UserDoc, input: ProfileUpdateInput): Promise<UserDoc> {
  if (input.onboardingCompleted) {
    const teaching = input.skillsTeaching ?? user.skillsTeaching;
    const learning = input.skillsLearning ?? user.skillsLearning;
    if (teaching.length === 0 || learning.length === 0) {
      throw badRequest('Add at least one skill to teach and one to learn to finish setting up.');
    }
  }
  // `input` was parsed by a strict schema, so only whitelisted profile fields can be present.
  user.set(input);
  await user.save();
  return user;
}

export async function changePassword(
  ctx: AppContext,
  user: UserDoc,
  input: ChangePasswordInput,
): Promise<UserDoc> {
  // Everyone shares a demo account's password; one visitor must not be able to lock the others out.
  if (user.isDemo) throw forbidden('Demo accounts share a password, so it cannot be changed.');
  const withPassword = await User.findById(user._id).select('+password');
  if (!withPassword) throw notFound('Account');
  const matches = await bcrypt.compare(input.currentPassword, withPassword.password);
  if (!matches) {
    throw new AppError(400, 'validation_failed', 'Some fields need attention.', {
      currentPassword: 'That is not your current password.',
    });
  }
  withPassword.password = await hashPassword(ctx, input.newPassword);
  // Signs out every other device.
  withPassword.tokenVersion += 1;
  await withPassword.save();
  return withPassword;
}
