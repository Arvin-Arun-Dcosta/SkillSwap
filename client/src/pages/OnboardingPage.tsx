import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  AvailabilityForm,
  BasicsForm,
  LearningForm,
  TeachingForm,
} from '@/features/profile/ProfileForms';
import { cn } from '@/lib/cn';
import { usePageTitle } from '@/lib/hooks';

const STEPS = [
  { title: 'About you', description: 'How other members will see you.' },
  { title: 'What you teach', description: 'Skills you could help someone else with.' },
  { title: 'What you want to learn', description: 'This is what we match you on.' },
  { title: 'When and how', description: 'Used to rank partners whose schedule fits yours.' },
];

/** First-run setup. Every step saves on its own, so nothing is lost by leaving half-way. */
export default function OnboardingPage() {
  usePageTitle('Set up your profile');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const current = STEPS[step];

  // Move focus to the new step's heading so keyboard and screen-reader users follow along.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  if (!user || !current) return null;
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back =
    step > 0 ? (
      <Button variant="ghost" onClick={() => setStep(step - 1)}>
        Back
      </Button>
    ) : undefined;

  return (
    <div className="container-page max-w-3xl py-8 sm:py-12">
      <h1 className="text-2xl font-bold sm:text-3xl">
        {user.onboardingCompleted ? 'Review your profile' : `Welcome, ${user.name.split(' ')[0]}`}
      </h1>
      <p className="mt-2 text-muted">Four short steps and you are ready to find a partner.</p>

      <ol className="mt-6 flex gap-2" aria-label="Setup progress">
        {STEPS.map((s, index) => (
          <li
            key={s.title}
            aria-current={index === step ? 'step' : undefined}
            className="flex flex-1 flex-col gap-2"
          >
            <span
              className={cn(
                'h-1.5 rounded-full',
                index < step ? 'bg-success' : index === step ? 'bg-primary' : 'bg-surface-2',
              )}
            />
            <span
              className={cn(
                'hidden items-center gap-1 text-sm sm:flex',
                index === step ? 'font-bold' : 'text-muted',
              )}
            >
              {index < step && <Check className="size-4 text-success" aria-hidden="true" />}
              {s.title}
              {index < step && <span className="sr-only">(done)</span>}
            </span>
          </li>
        ))}
      </ol>

      <Card className="mt-6">
        <p className="text-sm font-semibold text-muted">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-bold outline-none">
          {current.title}
        </h2>
        <p className="mb-6 mt-1 text-muted">{current.description}</p>

        {step === 0 && <BasicsForm submitLabel="Save and continue" onSaved={next} />}
        {step === 1 && (
          <TeachingForm submitLabel="Save and continue" secondary={back} onSaved={next} />
        )}
        {step === 2 && (
          <LearningForm submitLabel="Save and continue" secondary={back} onSaved={next} />
        )}
        {step === 3 && (
          <AvailabilityForm
            submitLabel="Finish and find partners"
            secondary={back}
            completeOnboarding
            onSaved={() => void navigate('/dashboard')}
          />
        )}
      </Card>
    </div>
  );
}
