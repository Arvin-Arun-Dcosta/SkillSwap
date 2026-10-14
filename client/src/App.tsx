import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  Suspense,
  lazy,
  useEffect,
  useRef,
} from 'react';
import { BrowserRouter, Outlet, Route, Routes, useLocation } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { Button, PageLoading, ToastProvider } from '@/components/ui';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { GuestOnly, RequireAuth } from '@/features/auth/guards';
import { SocketProvider } from '@/features/realtime/SocketProvider';
import { ApiError } from '@/lib/api';
import LandingPage from '@/pages/LandingPage';
import NotFoundPage from '@/pages/NotFoundPage';

// Everything behind sign-in is split out, so first-time visitors download only the public pages.
const LoginPage = lazy(() => import('@/pages/AuthPages').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import('@/pages/AuthPages').then((m) => ({ default: m.RegisterPage })),
);
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const DiscoverPage = lazy(() => import('@/pages/DiscoverPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const ExchangesPage = lazy(() => import('@/pages/ExchangesPage'));
const SessionsPage = lazy(() => import('@/pages/SessionsPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const RoomPage = lazy(() => import('@/room/RoomPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Retrying cannot fix a 4xx; it only delays the message the member needs to see.
      retry: (count, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

/** Last line of defence: a rendering error shows a recovery screen instead of a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled rendering error', error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center"
      >
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="max-w-md text-muted">
          This page hit an unexpected problem. Reloading usually fixes it; your work is saved.
        </p>
        <Button onClick={() => window.location.reload()}>Reload the page</Button>
      </div>
    );
  }
}

/** On navigation: start at the top and move focus to the page content, as a full page load would. */
function RouteAnnouncer() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    // The first page load keeps the browser's own focus order, so the skip link comes first.
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}

function RequireAdmin() {
  const { user } = useAuth();
  // Checked before the admin bundle or any admin request is loaded.
  if (user?.role !== 'ADMIN') return <NotFoundPage />;
  return <Outlet />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <SocketProvider>
              <BrowserRouter>
                <RouteAnnouncer />
                <Routes>
                  <Route element={<AppShell />}>
                    <Route index element={<LandingPage />} />
                    <Route path="discover" element={<DiscoverPage />} />
                    <Route path="profile/:username" element={<ProfilePage />} />
                    <Route element={<GuestOnly />}>
                      <Route path="login" element={<LoginPage />} />
                      <Route path="register" element={<RegisterPage />} />
                    </Route>
                    <Route element={<RequireAuth />}>
                      <Route path="onboarding" element={<OnboardingPage />} />
                      <Route path="dashboard" element={<DashboardPage />} />
                      <Route path="exchanges" element={<ExchangesPage />} />
                      <Route path="sessions" element={<SessionsPage />} />
                      <Route path="settings" element={<SettingsPage />} />
                      <Route element={<RequireAdmin />}>
                        <Route path="admin" element={<AdminPage />} />
                      </Route>
                    </Route>
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                  {/* The learning room is a full-screen workspace with its own frame. */}
                  <Route element={<RequireAuth />}>
                    <Route
                      path="session/:roomCode"
                      element={
                        <Suspense fallback={<PageLoading label="Opening the room" />}>
                          <RoomPage />
                        </Suspense>
                      }
                    />
                  </Route>
                </Routes>
              </BrowserRouter>
            </SocketProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
