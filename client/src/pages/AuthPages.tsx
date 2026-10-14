import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router';
import { LIMITS, loginSchema, registerSchema } from '@skillswap/shared';
import { Button, Card, Input, Notice } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { DemoAccounts } from '@/features/auth/DemoAccounts';
import { applyServerErrors } from '@/lib/forms';
import { usePageTitle } from '@/lib/hooks';

function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="container-page flex justify-center py-10 sm:py-16">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
          <p className="mt-2 text-muted">{subtitle}</p>
        </div>
        <Card>{children}</Card>
        <p className="text-center text-sm text-muted">{footer}</p>
        <DemoAccounts variant="panel" />
      </div>
    </div>
  );
}

function PasswordToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={visible}
      className="absolute right-1 top-[1.875rem] flex size-9 items-center justify-center rounded-md text-muted hover:text-text"
    >
      {visible ? (
        <EyeOff className="size-5" aria-hidden="true" />
      ) : (
        <Eye className="size-5" aria-hidden="true" />
      )}
      <span className="sr-only">{visible ? 'Hide password' : 'Show password'}</span>
    </button>
  );
}

export function LoginPage() {
  usePageTitle('Sign in');
  const { login } = useAuth();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '' },
  });
  const redirected = Boolean((location.state as { from?: string } | null)?.from);

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      footer={
        <>
          New to SkillSwap?{' '}
          <Link to="/register" className="font-semibold text-primary underline">
            Create an account
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit(async (values) => {
          setFormError(null);
          try {
            // On success the guest-only route guard redirects to where the member was headed.
            await login(values);
          } catch (error) {
            setFormError(applyServerErrors(error, setError, ['identifier', 'password']));
          }
        })}
      >
        {redirected && !formError && <Notice tone="neutral">Sign in to continue.</Notice>}
        {formError && <Notice>{formError}</Notice>}
        <Input
          label="Email or username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          error={errors.identifier?.message}
          {...register('identifier')}
        />
        <div className="relative">
          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className="pr-11"
            error={errors.password?.message}
            {...register('password')}
          />
          <PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />
        </div>
        <Button type="submit" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  usePageTitle('Create an account');
  const { register: signUp } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(registerSchema),
    mode: 'onTouched',
    defaultValues: { name: '', username: '', email: '', password: '' },
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Next you will add the skills you teach and the ones you want to learn."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-primary underline">
            Sign in
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit(async (values) => {
          setFormError(null);
          try {
            // New members are sent on to onboarding by the route guards.
            await signUp(values);
          } catch (error) {
            setFormError(
              applyServerErrors(error, setError, ['name', 'username', 'email', 'password']),
            );
          }
        })}
      >
        {formError && <Notice>{formError}</Notice>}
        <Input
          label="Name"
          autoComplete="name"
          error={errors.name?.message}
          {...register('name')}
        />
        <Input
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          hint={`${LIMITS.usernameMin} to ${LIMITS.usernameMax} letters, numbers or underscores. Shown in your profile link.`}
          error={errors.username?.message}
          {...register('username')}
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <div className="relative">
          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            className="pr-11"
            hint={`At least ${LIMITS.passwordMin} characters, with a letter and a number or symbol.`}
            error={errors.password?.message}
            {...register('password')}
          />
          <PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />
        </div>
        <Button type="submit" loading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
