import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type {
  AdminStats,
  AdminUser,
  Paginated,
  ReportAction,
  ReportDTO,
  ReportStatus,
} from '@skillswap/shared';
import { ColumnChart, PairedBarChart } from '@/components/domain/charts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  SectionHeading,
  Skeleton,
  SkeletonList,
  Tabs,
  type Tone,
  tabPanelProps,
  useToast,
} from '@/components/ui';
import { api, errorMessage, toQuery } from '@/lib/api';
import { formatDate, formatRating } from '@/lib/format';
import { useDebounced, usePageTitle } from '@/lib/hooks';

const TABS = ['overview', 'members', 'reports'] as const;
type TabId = (typeof TABS)[number];

const dayShort = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const dayLong = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
      {detail && <p className="text-sm text-muted">{detail}</p>}
    </Card>
  );
}

function Overview() {
  const query = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get<AdminStats>('/admin/stats'),
  });
  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading statistics" className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-lg" />
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  const { totals, completionRate, activity, topSkills } = query.data;
  const series = (key: 'signups' | 'exchanges' | 'sessions') =>
    activity.map((day) => {
      const date = new Date(`${day.date}T00:00:00Z`);
      return { label: dayShort.format(date), longLabel: dayLong.format(date), value: day[key] };
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Members"
          value={totals.users.toLocaleString()}
          detail={`${totals.activeUsers.toLocaleString()} active, ${totals.suspendedUsers.toLocaleString()} suspended`}
        />
        <StatTile
          label="Sessions"
          value={totals.sessions.toLocaleString()}
          detail={`${totals.completedSessions.toLocaleString()} completed`}
        />
        <StatTile
          label="Completion rate"
          value={completionRate === null ? 'No data' : `${completionRate}%`}
          detail="Completed out of completed and cancelled"
        />
        <StatTile
          label="Exchanges proposed"
          value={totals.exchanges.toLocaleString()}
          detail={`${totals.activeContracts.toLocaleString()} active contracts`}
        />
      </div>

      <Card>
        <h2 className="text-lg font-bold">Activity, last 14 days</h2>
        <p className="mt-1 text-sm text-muted">
          Counted per day in UTC. Each chart has its own scale.
        </p>
        <div className="mt-6 grid gap-8 lg:grid-cols-3">
          <ColumnChart title="Sign-ups" unit="sign-up" points={series('signups')} />
          <ColumnChart title="Exchanges proposed" unit="proposal" points={series('exchanges')} />
          <ColumnChart title="Sessions completed" unit="session" points={series('sessions')} />
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Most listed skills</h2>
        <p className="mb-6 mt-1 text-sm text-muted">
          How many members teach each skill, and how many want to learn it.
        </p>
        {topSkills.length === 0 ? (
          <p className="text-muted">No member has listed a skill yet.</p>
        ) : (
          <PairedBarChart
            title="Members per skill"
            seriesA="Teach it"
            seriesB="Want to learn it"
            rows={topSkills.map((s) => ({ label: s.skill, a: s.teachers, b: s.learners }))}
          />
        )}
      </Card>
    </div>
  );
}

function Members() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState<AdminUser | null>(null);
  const q = useDebounced(search.trim(), 300);

  const query = useQuery({
    queryKey: ['admin', 'users', q, page],
    queryFn: () =>
      api.get<Paginated<AdminUser>>(`/admin/users${toQuery({ q, page, pageSize: 20 })}`),
    placeholderData: (previous) => previous,
  });

  const setStatus = useMutation({
    mutationFn: (member: AdminUser) =>
      api.post(`/admin/users/${member.id}/status`, {
        status: member.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
      }),
    onSuccess: (_data, member) => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success(
        member.status === 'ACTIVE' ? `${member.name} suspended.` : `${member.name} reinstated.`,
      );
      setConfirming(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setConfirming(null);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <Input
          label="Search members"
          hideLabel
          type="search"
          placeholder="Search by name, username or email"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="pl-10"
        />
      </div>

      {query.isPending && <SkeletonList count={5} className="h-20" />}
      {query.isError && (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      )}
      {query.data && (
        <>
          <p className="text-sm text-muted" role="status">
            {query.data.total} {query.data.total === 1 ? 'member' : 'members'}
          </p>
          {/* A list of cards rather than a wide table: it reads the same on a phone. */}
          <ul className="flex flex-col gap-3">
            {query.data.items.map((member) => (
              <li key={member.id}>
                <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Avatar user={member} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      <Link to={`/profile/${member.username}`} className="truncate hover:underline">
                        {member.name}
                      </Link>
                      {member.role === 'ADMIN' && <Badge tone="primary">Admin</Badge>}
                      {member.isDemo && <Badge>Demo</Badge>}
                      <Badge tone={member.status === 'ACTIVE' ? 'success' : 'danger'}>
                        {member.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                      </Badge>
                    </p>
                    <p className="break-all text-sm text-muted">
                      @{member.username} · {member.email}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      Joined {formatDate(member.createdAt)} · {member.stats.sessionsCompleted}{' '}
                      sessions · teaching rating:{' '}
                      {formatRating(member.stats.teachingRating).toLowerCase()}
                      {member.teaching.length > 0 &&
                        ` · teaches ${member.teaching.slice(0, 3).join(', ')}`}
                    </p>
                  </div>
                  {member.role !== 'ADMIN' && (
                    <Button
                      variant={member.status === 'ACTIVE' ? 'secondary' : 'primary'}
                      size="sm"
                      onClick={() => setConfirming(member)}
                    >
                      {member.status === 'ACTIVE' ? 'Suspend' : 'Reinstate'}
                      <span className="sr-only"> {member.name}</span>
                    </Button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
          <Pagination
            page={query.data.page}
            totalPages={query.data.totalPages}
            onChange={setPage}
          />
        </>
      )}

      {confirming && (
        <ConfirmDialog
          open
          onClose={() => setConfirming(null)}
          onConfirm={() => setStatus.mutate(confirming)}
          loading={setStatus.isPending}
          variant={confirming.status === 'ACTIVE' ? 'danger' : 'primary'}
          title={
            confirming.status === 'ACTIVE'
              ? `Suspend ${confirming.name}?`
              : `Reinstate ${confirming.name}?`
          }
          description={
            confirming.status === 'ACTIVE'
              ? 'They will be signed out everywhere immediately and will not be able to sign in until reinstated.'
              : 'They will be able to sign in and use SkillSwap again.'
          }
          confirmLabel={confirming.status === 'ACTIVE' ? 'Suspend member' : 'Reinstate member'}
        />
      )}
    </div>
  );
}

const REPORT_STATUS: Record<ReportStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Needs review', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  DISMISSED: { label: 'Dismissed', tone: 'neutral' },
};

const ACTION_LABEL: Record<ReportAction, string> = {
  NONE: 'No action',
  WARNED: 'Member warned',
  SUSPENDED: 'Member suspended',
};

interface Resolution {
  report: ReportDTO;
  status: 'RESOLVED' | 'DISMISSED';
  action: ReportAction;
}

function Reports() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Resolution | null>(null);
  const query = useQuery({
    queryKey: ['admin', 'reports'],
    queryFn: async () => (await api.get<{ items: ReportDTO[] }>('/admin/reports')).items,
  });

  const resolve = useMutation({
    mutationFn: ({ report, status, action }: Resolution) =>
      api.post(`/admin/reports/${report.id}/resolve`, { status, action }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success('Report updated.');
      setPending(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setPending(null);
    },
  });

  if (query.isPending) return <SkeletonList className="h-40" />;
  if (query.isError) {
    return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  if (query.data.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck className="size-6" aria-hidden="true" />}
        title="No reports"
        description="Reports filed by members from a profile page appear here."
      />
    );
  }

  const describe = (r: Resolution) =>
    r.status === 'DISMISSED'
      ? {
          title: 'Dismiss this report?',
          description:
            'No action is taken against the reported member. The report is kept for the record.',
          confirm: 'Dismiss report',
        }
      : r.action === 'SUSPENDED'
        ? {
            title: `Suspend ${r.report.reportedUser?.name ?? 'this member'}?`,
            description:
              'They are signed out immediately and cannot sign in until reinstated from the Members tab.',
            confirm: 'Suspend member',
          }
        : {
            title: `Warn ${r.report.reportedUser?.name ?? 'this member'}?`,
            description:
              'They receive a notification that a report was made and that further reports may lead to suspension.',
            confirm: 'Send warning',
          };

  return (
    <>
      <ul className="flex flex-col gap-4">
        {query.data.map((report) => {
          const status = REPORT_STATUS[report.status];
          return (
            <li key={report.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-bold">{report.reason}</h2>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                <p className="whitespace-pre-line break-words">{report.details}</p>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted">About</dt>
                    <dd className="font-semibold">
                      {report.reportedUser ? (
                        <Link
                          to={`/profile/${report.reportedUser.username}`}
                          className="hover:underline"
                        >
                          {report.reportedUser.name}
                        </Link>
                      ) : (
                        'Deleted member'
                      )}
                      {report.reportedUser?.status === 'SUSPENDED' && (
                        <span className="font-normal text-muted"> (suspended)</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Reported by</dt>
                    <dd className="font-semibold">{report.reporter?.name ?? 'Deleted member'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Filed</dt>
                    <dd className="font-semibold">{formatDate(report.createdAt)}</dd>
                  </div>
                </dl>
                {report.status === 'PENDING' ? (
                  <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setPending({ report, status: 'DISMISSED', action: 'NONE' })}
                    >
                      Dismiss
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setPending({ report, status: 'RESOLVED', action: 'WARNED' })}
                    >
                      Warn member
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() =>
                        setPending({ report, status: 'RESOLVED', action: 'SUSPENDED' })
                      }
                    >
                      Suspend member
                    </Button>
                  </div>
                ) : (
                  <p className="border-t border-border pt-3 text-sm text-muted">
                    {ACTION_LABEL[report.action]}
                    {report.resolvedAt && ` on ${formatDate(report.resolvedAt)}`}
                  </p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
      {pending && (
        <ConfirmDialog
          open
          onClose={() => setPending(null)}
          onConfirm={() => resolve.mutate(pending)}
          loading={resolve.isPending}
          variant={pending.action === 'SUSPENDED' ? 'danger' : 'primary'}
          title={describe(pending).title}
          description={describe(pending).description}
          confirmLabel={describe(pending).confirm}
        />
      )}
    </>
  );
}

export default function AdminPage() {
  usePageTitle('Moderation');
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: TabId = (TABS as readonly string[]).includes(requested ?? '')
    ? (requested as TabId)
    : 'overview';

  return (
    <div className="container-page flex flex-col gap-6 py-8 sm:py-10">
      <SectionHeading
        as="h1"
        title="Moderation"
        description="Platform activity, member accounts and reports. Every number is counted from live data."
      />
      <Tabs
        label="Moderation sections"
        idBase="admin"
        value={tab}
        onChange={(id) => setParams({ tab: id }, { replace: true })}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'members', label: 'Members' },
          { id: 'reports', label: 'Reports' },
        ]}
      />
      <div {...tabPanelProps('admin', tab)} className="outline-none">
        {tab === 'overview' && <Overview />}
        {tab === 'members' && <Members />}
        {tab === 'reports' && <Reports />}
      </div>
    </div>
  );
}
