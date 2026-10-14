import {
  ArrowLeftRight,
  CalendarDays,
  ChevronDown,
  Compass,
  LayoutDashboard,
  LogOut,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  UserRound,
} from 'lucide-react';
import { Suspense } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { Avatar, ButtonLink, IconButton, Menu, PageLoading, menuItemClass } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';
import { Logo } from './Logo';
import { NotificationsMenu } from './NotificationsMenu';

const MEMBER_LINKS = [
  { to: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/exchanges', label: 'Exchanges', icon: ArrowLeftRight },
  { to: '/sessions', label: 'Sessions', icon: CalendarDays },
] as const;

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <IconButton
      label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={toggle}
    >
      {theme === 'dark' ? (
        <Sun className="size-5" aria-hidden="true" />
      ) : (
        <Moon className="size-5" aria-hidden="true" />
      )}
    </IconButton>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <Menu
      trigger={(props) => (
        <button
          type="button"
          className="flex h-11 items-center gap-2 rounded-md pl-1 pr-2 hover:bg-surface-2"
          {...props}
        >
          <Avatar user={user} size="sm" />
          <span className="hidden max-w-32 truncate text-sm font-semibold lg:block">
            {user.name.split(' ')[0]}
          </span>
          <ChevronDown className="size-4 text-muted" aria-hidden="true" />
          <span className="sr-only">Account menu</span>
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="border-b border-border px-3 pb-2.5 pt-1.5">
            <p className="truncate text-sm font-bold">{user.name}</p>
            <p className="truncate text-sm text-muted">@{user.username}</p>
          </div>
          <nav aria-label="Account" className="pt-1.5">
            <Link to={`/profile/${user.username}`} onClick={close} className={menuItemClass}>
              <UserRound className="size-4" aria-hidden="true" />
              Your profile
            </Link>
            <Link to="/settings" onClick={close} className={menuItemClass}>
              <Settings className="size-4" aria-hidden="true" />
              Settings
            </Link>
            {user.role === 'ADMIN' && (
              <Link to="/admin" onClick={close} className={menuItemClass}>
                <ShieldCheck className="size-4" aria-hidden="true" />
                Moderation
              </Link>
            )}
            <button
              type="button"
              className={cn(menuItemClass, 'text-danger')}
              onClick={() => {
                close();
                // Leave the protected page first, so signing out does not bounce through /login.
                void navigate('/');
                void logout();
              }}
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </nav>
        </>
      )}
    </Menu>
  );
}

function Header() {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur-sm">
      <div className="container-page flex h-16 items-center gap-2">
        <Link
          to={user ? '/dashboard' : '/'}
          className="mr-auto rounded-md"
          aria-label="SkillSwap home"
        >
          <Logo />
        </Link>

        {user ? (
          <nav aria-label="Main" className="mr-2 hidden md:flex md:items-center md:gap-1">
            {MEMBER_LINKS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'inline-flex h-11 items-center rounded-md px-3 text-sm font-semibold transition-colors',
                    isActive ? 'bg-surface-2 text-text' : 'text-muted hover:text-text',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        ) : (
          <nav aria-label="Main" className="mr-1 hidden sm:block">
            <NavLink
              to="/discover"
              className="inline-flex h-11 items-center rounded-md px-3 text-sm font-semibold text-muted hover:text-text"
            >
              Discover
            </NavLink>
          </nav>
        )}

        <ThemeToggle />
        {user ? (
          <>
            <NotificationsMenu />
            <UserMenu />
          </>
        ) : (
          <>
            <ButtonLink to="/login" variant="ghost" size="sm" className="h-11">
              Sign in
            </ButtonLink>
            <ButtonLink to="/register" size="sm" className="h-11">
              Join
            </ButtonLink>
          </>
        )}
      </div>
    </header>
  );
}

/** Bottom tab bar: the four main destinations, within thumb reach on phones. */
function MobileNav() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-4">
        {MEMBER_LINKS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold',
                  isActive ? 'text-primary' : 'text-muted',
                )
              }
            >
              <Icon className="size-5" aria-hidden="true" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="container-page flex flex-col gap-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} SkillSwap. Learn by teaching each other.</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link to="/discover" className="hover:text-text hover:underline">
            Discover members
          </Link>
          <Link to="/register" className="hover:text-text hover:underline">
            Create an account
          </Link>
          <Link to="/login" className="hover:text-text hover:underline">
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}

/** Frame shared by every page except the learning room. */
export function AppShell() {
  const { user } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
      {/* At least one screen tall, so content arriving after load never pushes the footer around. */}
      <main
        id="main"
        tabIndex={-1}
        className={cn('min-h-dvh flex-1 outline-none', user && 'pb-20 md:pb-0')}
      >
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </main>
      {!user && <Footer />}
      {user && <MobileNav />}
    </div>
  );
}
