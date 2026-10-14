import { ArrowLeftRight, MapPin } from 'lucide-react';
import { Link } from 'react-router';
import type { DiscoverUser } from '@skillswap/shared';
import { Avatar, Button, ButtonLink, Card, Rating } from '@/components/ui';
import { useSocket } from '@/features/realtime/SocketProvider';
import { MatchBadge } from './MatchBadge';
import { SkillChipList } from './SkillChip';

export function UserCard({
  user,
  onPropose,
  headingLevel = 'h3',
}: {
  user: DiscoverUser;
  /** Match the page outline: `h2` directly under a page title, `h3` inside a titled section. */
  headingLevel?: 'h2' | 'h3';
  /** Omit to hide the action, for example when browsing signed out. */
  onPropose?: (user: DiscoverUser) => void;
}) {
  const { isOnline } = useSocket();
  const Heading = headingLevel;
  return (
    <Card className="flex h-full flex-col gap-4">
      <div className="flex items-start gap-3">
        <Avatar user={user} size="md" online={isOnline(user.id, user.isOnline)} />
        <div className="min-w-0 flex-1">
          <Heading className="truncate text-base font-bold">
            <Link to={`/profile/${user.username}`} className="hover:underline">
              {user.name}
            </Link>
          </Heading>
          {user.location && (
            <p className="flex items-center gap-1 truncate text-sm text-muted">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{user.location}</span>
            </p>
          )}
        </div>
        {user.match && <MatchBadge match={user.match} />}
      </div>

      {user.headline && <p className="line-clamp-2 text-sm text-muted">{user.headline}</p>}

      <div className="flex flex-col gap-3">
        <SkillChipList
          label="Teaches"
          kind="teach"
          skills={user.skillsTeaching.map((s) => ({ skill: s.skill, detail: s.proficiency }))}
        />
        <SkillChipList
          label="Wants to learn"
          kind="learn"
          skills={user.skillsLearning.map((s) => ({ skill: s.skill }))}
        />
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <Rating value={user.stats.teachingRating} count={user.stats.teachingReviews} />
        <div className="flex gap-2">
          <ButtonLink to={`/profile/${user.username}`} variant="secondary" size="sm">
            View<span className="sr-only"> {user.name}&rsquo;s profile</span>
          </ButtonLink>
          {onPropose && (
            <Button
              size="sm"
              onClick={() => onPropose(user)}
              icon={<ArrowLeftRight className="size-4" aria-hidden="true" />}
            >
              Propose<span className="sr-only"> an exchange with {user.name}</span>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
