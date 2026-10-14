import {
  ArrowLeftRight,
  ArrowRight,
  CalendarCheck,
  Code2,
  FileText,
  Handshake,
  MessageSquare,
  PenLine,
  Search,
  Star,
  UserRoundPen,
  Video,
} from 'lucide-react';
import { SkillChip } from '@/components/domain/SkillChip';
import { DemoAccounts } from '@/features/auth/DemoAccounts';
import { ButtonLink, Card } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { usePageTitle } from '@/lib/hooks';

const STEPS = [
  {
    icon: UserRoundPen,
    title: 'Say what you teach and what you want',
    text: 'List the skills you can share and the ones you are after, with your level and when you are free.',
  },
  {
    icon: Search,
    title: 'Find someone who fits',
    text: 'Members are ranked by how well your skills, schedules and languages line up, and you can see why.',
  },
  {
    icon: Handshake,
    title: 'Agree a plan',
    text: 'Propose a number of sessions and goals. Your partner can accept, decline or suggest changes.',
  },
  {
    icon: CalendarCheck,
    title: 'Meet, learn, review',
    text: 'Schedule sessions, meet in a shared room, and leave each other a review when you are done.',
  },
];

const ROOM_TOOLS = [
  { icon: Video, title: 'Video and screen sharing', text: 'A direct call between the two of you.' },
  { icon: Code2, title: 'Shared code editor', text: 'Type together; run JavaScript in a sandbox.' },
  { icon: PenLine, title: 'Whiteboard', text: 'Sketch ideas with mouse, pen or finger.' },
  { icon: FileText, title: 'Notes and files', text: 'Saved with the session for later.' },
  { icon: MessageSquare, title: 'Chat', text: 'For links and quick questions.' },
  { icon: Star, title: 'Reviews', text: 'Only possible after a real session.' },
];

/** The two-sided idea of the product in one picture. */
function SwapIllustration() {
  const people = [
    { name: 'Arjun', teaches: 'Java', wants: 'Video Editing' },
    { name: 'Rahul', teaches: 'Video Editing', wants: 'Java' },
  ];
  return (
    <div
      className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]"
      role="img"
      aria-label="Example: Arjun teaches Java and wants to learn video editing; Rahul teaches video editing and wants to learn Java. They swap."
    >
      {people.map((person, index) => (
        <div key={person.name} className="contents">
          {index === 1 && (
            <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary text-on-primary">
              <ArrowLeftRight className="size-5 rotate-90 sm:rotate-0" aria-hidden="true" />
            </span>
          )}
          <Card className="flex flex-col gap-3">
            <p className="text-base font-bold">{person.name}</p>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                Teaches
              </p>
              <SkillChip skill={person.teaches} kind="teach" />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                Wants to learn
              </p>
              <SkillChip skill={person.wants} kind="learn" />
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}

export default function LandingPage() {
  usePageTitle('');
  const { user } = useAuth();
  const primaryTarget = user ? '/discover' : '/register';

  return (
    <>
      <section className="container-page grid gap-10 py-12 sm:py-16 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-24">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            Don&rsquo;t just learn. <span className="text-primary">Exchange.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            SkillSwap pairs you with someone who wants to learn what you know and can teach what you
            want. No fees: you pay each other in time.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink to={primaryTarget} size="lg">
              {user ? 'Find a partner' : 'Create your profile'}
              <ArrowRight className="size-5" aria-hidden="true" />
            </ButtonLink>
            <ButtonLink to="/discover" variant="secondary" size="lg">
              Browse members
            </ButtonLink>
          </div>
        </div>
        <SwapIllustration />
      </section>

      <section aria-labelledby="how-heading" className="border-y border-border bg-surface">
        <div className="container-page py-12 sm:py-16">
          <h2 id="how-heading" className="text-2xl font-bold sm:text-3xl">
            How it works
          </h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, text }, index) => (
              <li key={title} className="flex flex-col gap-3">
                <span className="flex size-11 items-center justify-center rounded-md bg-teach-bg text-teach">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="text-base font-bold">
                  <span className="text-muted">{index + 1}.</span> {title}
                </h3>
                <p className="text-muted">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="room-heading" className="container-page py-12 sm:py-16">
        <div className="max-w-2xl">
          <h2 id="room-heading" className="text-2xl font-bold sm:text-3xl">
            One room for the whole session
          </h2>
          <p className="mt-3 text-muted">
            Everything two people need to teach each other, in the browser, with nothing to install.
          </p>
        </div>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROOM_TOOLS.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <Card className="flex h-full items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-2">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-bold">{title}</h3>
                  <p className="mt-1 text-sm text-muted">{text}</p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {!user && <DemoAccounts variant="section" />}

      <section className="container-page pb-16">
        <div className="rounded-lg bg-primary px-6 py-10 text-center text-on-primary sm:py-14">
          <h2 className="text-2xl font-bold sm:text-3xl">
            Someone out there wants to learn what you know.
          </h2>
          <p className="mx-auto mt-3 max-w-xl opacity-90">
            Setting up a profile takes a few minutes.
          </p>
          <ButtonLink
            to={primaryTarget}
            variant="secondary"
            size="lg"
            className="mt-6 border-transparent"
          >
            {user ? 'Find a partner' : 'Get started'}
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
