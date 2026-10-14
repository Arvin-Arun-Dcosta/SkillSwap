import { Navigate, Outlet, useLocation } from 'react-router';
import { PageLoading } from '@/components/ui';
import { useAuth } from './AuthProvider';

/** Pages that a member with an unfinished profile may still open. */
const ALLOWED_BEFORE_ONBOARDING = ['/onboarding', '/settings'];

/** Requires a signed-in member; remembers where they were headed. */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoading label="Checking your session" />;
  if (!user) {
    const from = location.pathname + location.search;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  if (
    user.role === 'USER' &&
    !user.onboardingCompleted &&
    !ALLOWED_BEFORE_ONBOARDING.some((path) => location.pathname.startsWith(path))
  ) {
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}

/** Signed-in members have no use for the login and register pages. */
export function GuestOnly() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoading />;
  if (user) {
    const from = (location.state as { from?: string } | null)?.from;
    // Only ever redirect inside the app.
    const home = user.role === 'ADMIN' ? '/admin' : '/dashboard';
    const target = from && from.startsWith('/') && !from.startsWith('//') ? from : home;
    return <Navigate to={target} replace />;
  }
  return <Outlet />;
}
