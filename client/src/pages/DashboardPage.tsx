import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarPlus, Compass, Inbox, Video } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { DashboardResponse, DiscoverUser } from '@skillswap/shared';
import { ContractDialog } from '@/components/domain/ContractDialog';
import { ProposeExchangeDialog } from '@/components/domain/ExchangeDialogs';
import { ScheduleSessionDialog } from '@/components/domain/SessionDialogs';
import { SkillChip } from '@/components/domain/SkillChip';
import { UserCard } from '@/components/domain/UserCard';
import {
  Avatar,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorState,
  Progress,
  SectionHeading,
  Skeleton,
} from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatRating, formatRelative, plural } from '@/lib/format';
import { usePageTitle } from '@/lib/hooks';

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading your home" className="grid gap-6 lg:grid-cols-3">
      <Skeleton className="h-44 rounded-lg lg:col-span-2" />
      <Skeleton className="h-44 rounded-lg" />
      <Skeleton className="h-64 rounded-lg lg:col-span-3" />
    </div>
  );
}

export default function DashboardPage() {
  usePageTitle('Home');
  const { user } = useAuth();
  const [proposeTo, setProposeTo] = useState<DiscoverUser | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardResponse>('/dashboard'),
  });
  if (!user) return null;
  const data = query.data;
  const firstName = user.name.split(' ')[0];

  return (
    <div className="container-page flex flex-col gap-8 py-8 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Hello, {firstName}</h1>
          <p className="mt-1 text-muted">Here is what needs you, and what is coming up.</p>
        </div>
        <dl className="flex gap-6">
          <div>
            <dt className="text-sm text-muted">Sessions completed</dt>
            <dd className="text-xl font-bold tabular-nums">{user.stats.sessionsCompleted}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Teaching rating</dt>
            <dd
              className={
                user.stats.teachingRating === null
                  ? 'text-sm text-muted'
                  : 'text-xl font-bold tabular-nums'
              }
            >
              {formatRating(user.stats.teachingRating)}
            </dd>
          </div>
        </dl>
      </header>

      {query.isPending && <DashboardSkeleton />}
      {query.isError && (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      )}

      {data && (
        <>
          {data.profileCompleteness.percent < 100 && (
            <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
              <div className="flex-1">
                <h2 className="font-bold">
                  Your profile is {data.profileCompleteness.percent}% complete
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Next: {data.profileCompleteness.missing[0]?.toLowerCase()}. Fuller profiles get
                  better matches.
                </p>
                <div className="mt-3">
                  <Progress
                    value={data.profileCompleteness.percent}
                    max={100}
                    label="Profile completeness"
                  />
                </div>
              </div>
              <ButtonLink to="/settings" variant="secondary">
                Complete profile
              </ButtonLink>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <section aria-labelledby="next-heading" className="flex flex-col gap-4 lg:col-span-2">
              <SectionHeading
                id="next-heading"
                title="Next sessions"
                action={
                  data.activeContracts.length > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setScheduling(true)}
                      icon={<CalendarPlus className="size-4" aria-hidden="true" />}
                    >
                      Schedule
                    </Button>
                  )
                }
              />
              {data.nextSessions.length === 0 ? (
                <EmptyState
                  icon={<Video className="size-6" aria-hidden="true" />}
                  title="No sessions scheduled"
                  description={
                    data.activeContracts.length > 0
                      ? 'You have an active contract. Pick a time for your next session.'
                      : 'Sessions appear here once an exchange has been accepted.'
                  }
                  action={
                    data.activeContracts.length > 0 ? (
                      <Button onClick={() => setScheduling(true)}>Schedule a session</Button>
                    ) : (
                      <ButtonLink to="/discover">Find a partner</ButtonLink>
                    )
                  }
                />
              ) : (
                <ul className="flex flex-col gap-3">
                  {data.nextSessions.map((session) => {
                    const partner =
                      session.teacher.id === user.id ? session.learner : session.teacher;
                    const live = session.status === 'ACTIVE';
                    return (
                      <li key={session.id}>
                        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
                          <Avatar user={partner} size="md" />
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate font-bold">{session.title}</h3>
                            <p className="text-sm text-muted">
                              With {partner.name} ·{' '}
                              {session.teacher.id === user.id ? 'you teach' : 'you learn'}{' '}
                              {session.skill}
                            </p>
                            <p className="mt-1 text-sm">
                              {live ? (
                                <span className="font-semibold text-success">In progress now</span>
                              ) : (
                                <>
                                  <time dateTime={session.scheduledStartTime}>
                                    {formatDateTime(session.scheduledStartTime)}
                                  </time>{' '}
                                  <span className="text-muted">
                                    ({formatRelative(session.scheduledStartTime)})
                                  </span>
                                </>
                              )}
                            </p>
                          </div>
                          <ButtonLink
                            to={`/session/${session.roomCode}`}
                            variant={live ? 'primary' : 'secondary'}
                            icon={<Video className="size-4" aria-hidden="true" />}
                          >
                            {live ? 'Join now' : 'Open room'}
                          </ButtonLink>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="awaiting-heading" className="flex flex-col gap-4">
              <SectionHeading
                id="awaiting-heading"
                title="Waiting for your reply"
                action={
                  <Link
                    to="/exchanges"
                    className="text-sm font-semibold text-primary hover:underline"
                  >
                    All exchanges
                  </Link>
                }
              />
              {data.awaitingMe.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="size-6" aria-hidden="true" />}
                  title="You are all caught up"
                  description="New proposals and counter-offers will show up here."
                />
              ) : (
                <ul className="flex flex-col gap-3">
                  {data.awaitingMe.map((exchange) => {
                    const other = exchange.viewer.isSender ? exchange.receiver : exchange.sender;
                    return (
                      <li key={exchange.id}>
                        <Card className="flex flex-col gap-3">
                          <div className="flex items-center gap-3">
                            <Avatar user={other} size="sm" />
                            <p className="min-w-0 truncate text-sm font-bold">{other.name}</p>
                          </div>
                          <p className="text-sm text-muted">
                            {exchange.status === 'COUNTERED'
                              ? 'Sent a counter-offer'
                              : 'Proposed an exchange'}{' '}
                            {formatRelative(exchange.updatedAt)}
                          </p>
                          <ButtonLink to="/exchanges" variant="secondary" size="sm">
                            Review
                          </ButtonLink>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          {data.activeContracts.length > 0 && (
            <section aria-labelledby="contracts-heading" className="flex flex-col gap-4">
              <h2 id="contracts-heading" className="text-lg font-bold">
                Active contracts
              </h2>
              <ul className="grid gap-4 md:grid-cols-2">
                {data.activeContracts.map((contract) => {
                  const iAmA = contract.userA.id === user.id;
                  const partner = iAmA ? contract.userB : contract.userA;
                  return (
                    <li key={contract.id}>
                      <Card className="flex h-full flex-col gap-4">
                        <div className="flex items-center gap-3">
                          <Avatar user={partner} size="md" />
                          <div className="min-w-0">
                            <h3 className="truncate font-bold">With {partner.name}</h3>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <SkillChip
                                skill={iAmA ? contract.skillA : contract.skillB}
                                kind="teach"
                                detail="you teach"
                              />
                              <SkillChip
                                skill={iAmA ? contract.skillB : contract.skillA}
                                kind="learn"
                                detail="you learn"
                              />
                            </div>
                          </div>
                        </div>
                        <div>
                          <p className="mb-1.5 text-sm">
                            {contract.completedSessions} of{' '}
                            {plural(contract.totalSessions, 'session')} completed
                          </p>
                          <Progress
                            value={contract.completedSessions}
                            max={contract.totalSessions}
                            label={`Sessions completed with ${partner.name}`}
                          />
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-auto self-start"
                          onClick={() => setContractId(contract.id)}
                        >
                          View contract<span className="sr-only"> with {partner.name}</span>
                        </Button>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section aria-labelledby="matches-heading" className="flex flex-col gap-4">
            <SectionHeading
              id="matches-heading"
              title="Suggested partners"
              description="Ranked by how well your skills and schedules fit."
              action={
                <ButtonLink to="/discover" variant="ghost" size="sm">
                  See all
                  <ArrowRight className="size-4" aria-hidden="true" />
                </ButtonLink>
              }
            />
            {data.matches.length === 0 ? (
              <EmptyState
                icon={<Compass className="size-6" aria-hidden="true" />}
                title="No matches yet"
                description="Nobody overlaps with your skills right now. Adding more skills you teach or want widens the search."
                action={<ButtonLink to="/settings?tab=learn">Edit your skills</ButtonLink>}
              />
            ) : (
              <ul className="grid gap-4 md:grid-cols-2">
                {data.matches.map((match) => (
                  <li key={match.id}>
                    <UserCard user={match} onPropose={setProposeTo} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {proposeTo && <ProposeExchangeDialog target={proposeTo} onClose={() => setProposeTo(null)} />}
      {contractId && (
        <ContractDialog
          contractId={contractId}
          viewerId={user.id}
          onClose={() => setContractId(null)}
        />
      )}
      {scheduling && data && (
        <ScheduleSessionDialog
          contracts={data.activeContracts}
          viewerId={user.id}
          onClose={() => setScheduling(false)}
        />
      )}
    </div>
  );
}
