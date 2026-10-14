import { useQuery } from '@tanstack/react-query';
import { Search, SlidersHorizontal, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  DAYS,
  DISCOVER_SORTS,
  type DiscoverSort,
  type DiscoverUser,
  LIMITS,
  PROFICIENCY_LEVELS,
  type Paginated,
} from '@skillswap/shared';
import { ProposeExchangeDialog } from '@/components/domain/ExchangeDialogs';
import { UserCard } from '@/components/domain/UserCard';
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  SectionHeading,
  Select,
  Skeleton,
} from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage, toQuery } from '@/lib/api';
import { useDebounced, usePageTitle } from '@/lib/hooks';

const SORT_LABELS: Record<DiscoverSort, string> = {
  match: 'Best match',
  rating: 'Highest rated',
  sessions: 'Most sessions',
  recent: 'Newest members',
};

/** Filters live in the URL, so a search can be shared, bookmarked and restored with Back. */
export default function DiscoverPage() {
  usePageTitle('Discover members');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [proposeTo, setProposeTo] = useState<DiscoverUser | null>(null);

  const [search, setSearch] = useState(params.get('q') ?? '');
  const debouncedSearch = useDebounced(search.trim(), 300);

  const filters = {
    q: params.get('q') ?? '',
    proficiency: params.get('proficiency') ?? '',
    day: params.get('day') ?? '',
    minRating: params.get('minRating') ?? '',
    onlineOnly: params.get('onlineOnly') === 'true',
    sort: (DISCOVER_SORTS as readonly string[]).includes(params.get('sort') ?? '')
      ? (params.get('sort') as DiscoverSort)
      : user
        ? 'match'
        : 'rating',
    page: Math.max(1, Number(params.get('page')) || 1),
  };

  const update = (changes: Record<string, string | boolean | number | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || value === false) next.delete(key);
      else next.set(key, String(value));
    }
    // Any change to the filters starts again from the first page.
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (debouncedSearch !== filters.q) update({ q: debouncedSearch });
    // Only the debounced text should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = useQuery({
    queryKey: ['discover', filters, user?.id ?? null],
    queryFn: () =>
      api.get<Paginated<DiscoverUser>>(`/users/discover${toQuery({ ...filters, pageSize: 12 })}`),
    placeholderData: (previous) => previous,
  });

  const activeFilters = [
    filters.proficiency,
    filters.day,
    filters.minRating,
    filters.onlineOnly,
  ].filter(Boolean).length;
  const clear = () => {
    setSearch('');
    setParams({}, { replace: true });
  };

  const filterControls = (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Select
        label="Teacher's level"
        value={filters.proficiency}
        onChange={(e) => update({ proficiency: e.target.value })}
      >
        <option value="">Any level</option>
        {PROFICIENCY_LEVELS.map((level) => (
          <option key={level}>{level}</option>
        ))}
      </Select>
      <Select label="Free on" value={filters.day} onChange={(e) => update({ day: e.target.value })}>
        <option value="">Any day</option>
        {DAYS.map((day) => (
          <option key={day}>{day}</option>
        ))}
      </Select>
      <Select
        label="Teaching rating"
        value={filters.minRating}
        onChange={(e) => update({ minRating: e.target.value })}
      >
        <option value="">Any rating</option>
        <option value="4">4.0 and up</option>
        <option value="4.5">4.5 and up</option>
      </Select>
      <Select
        label="Sort by"
        value={filters.sort}
        onChange={(e) => update({ sort: e.target.value })}
      >
        {DISCOVER_SORTS.filter((sort) => user || sort !== 'match').map((sort) => (
          <option key={sort} value={sort}>
            {SORT_LABELS[sort]}
          </option>
        ))}
      </Select>
      <label className="flex min-h-11 items-center gap-3 self-end rounded-md border border-border-strong bg-surface px-3 text-sm font-semibold">
        <input
          type="checkbox"
          className="size-5 accent-(--primary)"
          checked={filters.onlineOnly}
          onChange={(e) => update({ onlineOnly: e.target.checked })}
        />
        Online now
      </label>
    </div>
  );

  return (
    <div className="container-page flex flex-col gap-6 py-8 sm:py-10">
      <SectionHeading
        as="h1"
        title="Discover members"
        description={
          user
            ? 'Ranked for you. Open a match score to see what it is made of.'
            : 'Browse who is teaching what. Sign in to see how well each member fits you.'
        }
      />

      <search className="flex flex-col gap-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            label="Search members"
            hideLabel
            type="search"
            placeholder="Search by skill, name or place"
            value={search}
            maxLength={LIMITS.searchMax}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Filters are always visible on larger screens and tucked into a disclosure on phones. */}
        <div className="hidden md:block">{filterControls}</div>
        <details className="rounded-md border border-border md:hidden">
          <summary className="flex min-h-11 items-center gap-2 px-3 text-sm font-semibold">
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Filters and sorting
            {activeFilters > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs text-on-primary">
                {activeFilters}
              </span>
            )}
          </summary>
          <div className="border-t border-border p-3">{filterControls}</div>
        </details>
      </search>

      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted" role="status">
          {query.data &&
            (query.data.total === 0
              ? 'No members match'
              : `${query.data.total} ${query.data.total === 1 ? 'member' : 'members'}`)}
          {query.isFetching && query.data && ' · updating…'}
        </p>
        {(activeFilters > 0 || filters.q) && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear all
          </Button>
        )}
      </div>

      {query.isPending && (
        <div
          role="status"
          aria-label="Loading members"
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-72 rounded-lg" />
          ))}
        </div>
      )}
      {query.isError && (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      )}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          icon={<UsersRound className="size-6" aria-hidden="true" />}
          title="No members match those filters"
          description="Try a broader search, or remove a filter."
          action={<Button onClick={clear}>Clear filters</Button>}
        />
      )}
      {query.data && query.data.items.length > 0 && (
        <>
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {query.data.items.map((member) => (
              <li key={member.id}>
                <UserCard
                  headingLevel="h2"
                  user={member}
                  onPropose={(target) => {
                    if (user) setProposeTo(target);
                    else
                      void navigate('/login', { state: { from: `/profile/${target.username}` } });
                  }}
                />
              </li>
            ))}
          </ul>
          <Pagination
            page={query.data.page}
            totalPages={query.data.totalPages}
            onChange={(page) => {
              update({ page });
              window.scrollTo({ top: 0 });
            }}
          />
        </>
      )}

      {proposeTo && <ProposeExchangeDialog target={proposeTo} onClose={() => setProposeTo(null)} />}
    </div>
  );
}
