import { GraduationCap, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * A skill, always coloured by direction: teal for skills someone teaches, amber for skills
 * someone wants to learn. The icon repeats the meaning so colour is never the only cue.
 */
export function SkillChip({
  skill,
  kind,
  detail,
  className,
}: {
  skill: string;
  kind: 'teach' | 'learn';
  /** Secondary text such as the proficiency level. */
  detail?: string;
  className?: string;
}) {
  const Icon = kind === 'teach' ? GraduationCap : Sparkles;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-sm px-2 py-1 text-sm font-semibold',
        kind === 'teach' ? 'bg-teach-bg text-teach' : 'bg-learn-bg text-learn',
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{skill}</span>
      {detail && <span className="shrink-0 font-normal opacity-90">· {detail}</span>}
    </span>
  );
}

export function SkillChipList({
  label,
  kind,
  skills,
  max = 3,
}: {
  label: string;
  kind: 'teach' | 'learn';
  skills: { skill: string; detail?: string }[];
  max?: number;
}) {
  if (skills.length === 0) return null;
  const shown = skills.slice(0, max);
  const hidden = skills.length - shown.length;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <ul className="flex flex-wrap gap-1.5">
        {shown.map((s) => (
          <li key={s.skill} className="max-w-full">
            <SkillChip skill={s.skill} kind={kind} detail={s.detail} />
          </li>
        ))}
        {hidden > 0 && (
          <li className="inline-flex items-center px-1 text-sm text-muted">+{hidden} more</li>
        )}
      </ul>
    </div>
  );
}
