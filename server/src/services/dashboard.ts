import type { DashboardResponse } from '@skillswap/shared';
import type { AppContext } from '../context';
import type { UserDoc } from '../models';
import { listContracts } from './contracts';
import { listAwaiting } from './exchanges';
import { listSessions } from './sessions';
import { profileCompleteness, topMatches } from './users';

export async function getDashboard(ctx: AppContext, user: UserDoc): Promise<DashboardResponse> {
  const [nextSessions, awaitingMe, activeContracts, matches] = await Promise.all([
    listSessions(user, { openOnly: true, limit: 3 }),
    listAwaiting(user, 3),
    listContracts(user, { activeOnly: true }),
    topMatches(ctx, user, 4),
  ]);
  return {
    nextSessions,
    awaitingMe,
    activeContracts,
    matches,
    profileCompleteness: profileCompleteness(user),
  };
}
