import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Card, Notice } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth, useConfig } from './AuthProvider';

/**
 * One-click sign-in for showcase accounts. Renders nothing unless the server reports that demo
 * mode is on, which it never is in production by default.
 */
export function DemoAccounts({ variant }: { variant: 'section' | 'panel' }) {
  const config = useConfig();
  const { demoLogin } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!config?.demoMode || config.demoAccounts.length === 0) return null;

  const signIn = async (username: string, isAdmin: boolean) => {
    setPending(username);
    setError(null);
    try {
      await demoLogin(username);
      // On the sign-in pages the guest-only guard redirects (and honours "return to"); elsewhere we do.
      if (variant === 'section') void navigate(isAdmin ? '/admin' : '/dashboard');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const resetNote =
    config.demoResetHours > 0
      ? ` Everything, including new accounts, resets to fresh demo data every ${config.demoResetHours} hours.`
      : '';

  const list = (
    <>
      {error && <Notice>{error}</Notice>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {config.demoAccounts.map((account) => (
          <li key={account.username}>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void signIn(account.username, account.role === 'ADMIN')}
              className="flex min-h-14 w-full flex-col items-start rounded-md border border-border-strong bg-surface px-3.5 py-2 text-left hover:bg-surface-2 disabled:opacity-60"
            >
              <span className="text-sm font-bold">
                {pending === account.username ? 'Signing in…' : account.name}
              </span>
              <span className="text-sm text-muted">{account.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  if (variant === 'panel') {
    return (
      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-bold">Just looking?</h2>
          <p className="text-sm text-muted">
            Sign in as a demo member. Use two browsers to try a session from both sides.
            {resetNote}
          </p>
        </div>
        {list}
      </Card>
    );
  }

  return (
    <section aria-labelledby="demo-heading" className="container-page pb-12 sm:pb-16">
      <Card className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-10">
        <div className="lg:max-w-sm">
          <h2 id="demo-heading" className="text-xl font-bold">
            Try it without signing up
          </h2>
          <p className="mt-2 text-muted">
            This server runs in demo mode. Pick a demo member to look around; open a second browser
            as their partner to try a session from both sides.
            {resetNote}
          </p>
        </div>
        <div className="flex flex-1 flex-col gap-3">{list}</div>
      </Card>
    </section>
  );
}
