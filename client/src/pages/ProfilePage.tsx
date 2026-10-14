import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  CalendarDays,
  Clock,
  Ellipsis,
  Flag,
  MapPin,
  Medal,
  Pencil,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { type ProfileResponse, TIME_SLOTS } from '@skillswap/shared';
import { ProposeExchangeDialog } from '@/components/domain/ExchangeDialogs';
import { MatchBreakdown } from '@/components/domain/MatchBadge';
import { ReportDialog } from '@/components/domain/SessionDialogs';
import { SkillChip } from '@/components/domain/SkillChip';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  ErrorState,
  IconButton,
  Menu,
  Rating,
  Skeleton,
  menuItemClass,
} from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useSocket } from '@/features/realtime/SocketProvider';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatDate, plural } from '@/lib/format';
import { usePageTitle } from '@/lib/hooks';
import NotFoundPage from './NotFoundPage';

export default function ProfilePage() {
  const { username = '' } = useParams();
  const { user: viewer } = useAuth();
  const { isOnline } = useSocket();
  const navigate = useNavigate();
  const [proposing, setProposing] = useState(false);
  const [reporting, setReporting] = useState(false);

  const query = useQuery({
    queryKey: ['profile', username, viewer?.id ?? null],
    queryFn: () => api.get<ProfileResponse>(`/users/${encodeURIComponent(username)}`),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  const profile = query.data;
  usePageTitle(profile ? profile.user.name : 'Profile');

  if (query.isPending) {
    return (
      <div
        role="status"
        aria-label="Loading profile"
        className="container-page flex flex-col gap-6 py-8"
      >
        {/* Sized like the real header card at each breakpoint, so the page does not jump on load. */}
        <Skeleton className="h-[22.5rem] rounded-lg sm:h-52" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-lg lg:col-span-2" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      </div>
    );
  }
  if (query.error instanceof ApiError && query.error.status === 404) return <NotFoundPage />;
  if (query.isError || !profile) {
    return (
      <div className="container-page py-8">
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const { user, reviews, match } = profile;
  const firstName = user.name.split(' ')[0];
  const online = isOnline(user.id, user.isOnline);
  const slotLabels = user.availability.timeSlots.map(
    (id) => TIME_SLOTS.find((slot) => slot.id === id)?.label ?? id,
  );

  const propose = () => {
    if (!viewer) return void navigate('/login', { state: { from: `/profile/${user.username}` } });
    setProposing(true);
  };

  return (
    <div className="container-page flex flex-col gap-6 py-8 sm:py-10">
      <Card className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <Avatar user={user} size="xl" online={online} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold sm:text-3xl">{user.name}</h1>
          <p className="text-muted">@{user.username}</p>
          {user.headline && <p className="mt-2 text-lg">{user.headline}</p>}
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted">
            {user.location && (
              <li className="flex items-center gap-1.5">
                <MapPin className="size-4" aria-hidden="true" />
                {user.location}
              </li>
            )}
            {user.timezone && (
              <li className="flex items-center gap-1.5">
                <Clock className="size-4" aria-hidden="true" />
                {user.timezone.replace(/_/g, ' ')}
              </li>
            )}
            <li className="flex items-center gap-1.5">
              <CalendarDays className="size-4" aria-hidden="true" />
              Joined {formatDate(user.joinedAt)}
            </li>
          </ul>
        </div>
        <div className="flex items-center gap-2 sm:flex-col sm:items-end">
          {profile.viewer.isSelf ? (
            <ButtonLink
              to="/settings"
              variant="secondary"
              icon={<Pencil className="size-4" aria-hidden="true" />}
            >
              Edit profile
            </ButtonLink>
          ) : profile.viewer.openExchangeId ? (
            <ButtonLink to="/exchanges" variant="secondary">
              View your exchange
            </ButtonLink>
          ) : (
            <Button
              onClick={propose}
              icon={<ArrowLeftRight className="size-4" aria-hidden="true" />}
            >
              Propose an exchange
            </Button>
          )}
          {viewer && !profile.viewer.isSelf && (
            <Menu
              trigger={(props) => (
                <IconButton label={`More actions for ${user.name}`} variant="secondary" {...props}>
                  <Ellipsis className="size-5" aria-hidden="true" />
                </IconButton>
              )}
            >
              {(close) => (
                <button
                  type="button"
                  className={menuItemClass}
                  onClick={() => {
                    close();
                    setReporting(true);
                  }}
                >
                  <Flag className="size-4" aria-hidden="true" />
                  Report this member
                </button>
              )}
            </Menu>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {user.bio && (
            <Card>
              <h2 className="text-lg font-bold">About</h2>
              <p className="mt-2 whitespace-pre-line">{user.bio}</p>
            </Card>
          )}

          <Card>
            <h2 className="text-lg font-bold">Teaches</h2>
            {user.skillsTeaching.length === 0 ? (
              <p className="mt-2 text-muted">No skills listed yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-border">
                {user.skillsTeaching.map((skill) => (
                  <li key={skill.skill} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <SkillChip skill={skill.skill} kind="teach" detail={skill.proficiency} />
                      <Rating value={skill.rating} count={skill.reviewCount} />
                    </div>
                    <p className="text-sm text-muted">
                      {plural(skill.yearsExperience, 'year')} of experience
                      {skill.description && ` · ${skill.description}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="text-lg font-bold">Wants to learn</h2>
            {user.skillsLearning.length === 0 ? (
              <p className="mt-2 text-muted">Nothing listed yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-border">
                {user.skillsLearning.map((skill) => (
                  <li key={skill.skill} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <SkillChip
                        skill={skill.skill}
                        kind="learn"
                        detail={`aiming for ${skill.targetProficiency}`}
                      />
                      <span className="text-sm text-muted">{skill.priority} priority</span>
                    </div>
                    {skill.notes && <p className="text-sm text-muted">{skill.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="text-lg font-bold">Reviews</h2>
            {reviews.length === 0 ? (
              <p className="mt-2 text-muted">
                No reviews yet. Reviews appear after {firstName} completes a session.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-border">
                {reviews.map((review) => (
                  <li key={review.id} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                    <Avatar user={review.reviewer} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-x-3">
                        <p className="text-sm font-bold">{review.reviewer.name}</p>
                        <p className="text-sm font-semibold">
                          <span className="sr-only">{review.rating} out of 5 stars</span>
                          <span aria-hidden="true">
                            {'★'.repeat(review.rating)}
                            <span className="text-border-strong">
                              {'★'.repeat(5 - review.rating)}
                            </span>
                          </span>
                        </p>
                      </div>
                      <p className="text-sm text-muted">
                        {review.role === 'TEACHER'
                          ? `Taught ${review.skill}`
                          : `Learned ${review.skill}`}{' '}
                        · {formatDate(review.createdAt)}
                      </p>
                      {review.feedback && <p className="mt-1.5 break-words">{review.feedback}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          {match && (
            <Card>
              <h2 className="text-lg font-bold">
                Your match: <span className="tabular-nums">{match.score}%</span>
              </h2>
              <div className="mt-4">
                <MatchBreakdown match={match} />
              </div>
            </Card>
          )}

          <Card>
            <h2 className="text-lg font-bold">Reputation</h2>
            <dl className="mt-3 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-sm text-muted">As a teacher</dt>
                <dd>
                  <Rating value={user.stats.teachingRating} count={user.stats.teachingReviews} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-sm text-muted">As a learner</dt>
                <dd>
                  <Rating value={user.stats.learningRating} count={user.stats.learningReviews} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-sm text-muted">Sessions completed</dt>
                <dd className="font-semibold tabular-nums">{user.stats.sessionsCompleted}</dd>
              </div>
            </dl>
            {user.badges.length > 0 && (
              <ul className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
                {user.badges.map((badge) => (
                  <li key={badge.id} className="flex items-start gap-2.5">
                    <Medal className="mt-0.5 size-5 shrink-0 text-learn" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-bold">{badge.name}</p>
                      <p className="text-sm text-muted">{badge.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="text-lg font-bold">Availability</h2>
            {user.availability.days.length === 0 && slotLabels.length === 0 ? (
              <p className="mt-2 text-muted">Not specified.</p>
            ) : (
              <dl className="mt-3 flex flex-col gap-3 text-sm">
                {user.availability.days.length > 0 && (
                  <div>
                    <dt className="text-muted">Days</dt>
                    <dd className="mt-1 flex flex-wrap gap-1.5">
                      {user.availability.days.map((day) => (
                        <Badge key={day}>{day.slice(0, 3)}</Badge>
                      ))}
                    </dd>
                  </div>
                )}
                {slotLabels.length > 0 && (
                  <div>
                    <dt className="text-muted">Times</dt>
                    <dd className="mt-1">{slotLabels.join(', ')}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted">Commitment</dt>
                  <dd className="mt-1">
                    About {plural(user.availability.hoursPerWeek, 'hour')} a week
                  </dd>
                </div>
                {user.preferences.languages.length > 0 && (
                  <div>
                    <dt className="text-muted">Languages</dt>
                    <dd className="mt-1">{user.preferences.languages.join(', ')}</dd>
                  </div>
                )}
              </dl>
            )}
          </Card>
        </aside>
      </div>

      {proposing && <ProposeExchangeDialog target={user} onClose={() => setProposing(false)} />}
      {reporting && <ReportDialog target={user} onClose={() => setReporting(false)} />}
    </div>
  );
}
