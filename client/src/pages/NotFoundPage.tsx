import { Compass } from 'lucide-react';
import { ButtonLink } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { usePageTitle } from '@/lib/hooks';

export default function NotFoundPage() {
  usePageTitle('Page not found');
  const { user } = useAuth();
  return (
    <div className="container-page flex min-h-[60dvh] flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-surface-2">
        <Compass className="size-7" aria-hidden="true" />
      </span>
      <h1 className="text-3xl font-bold">We could not find that page</h1>
      <p className="max-w-md text-muted">
        The link may be out of date, or the page may have moved. Nothing is broken on your side.
      </p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <ButtonLink to={user ? '/dashboard' : '/'}>
          {user ? 'Go to your home' : 'Go to the home page'}
        </ButtonLink>
        <ButtonLink to="/discover" variant="secondary">
          Browse members
        </ButtonLink>
      </div>
    </div>
  );
}
