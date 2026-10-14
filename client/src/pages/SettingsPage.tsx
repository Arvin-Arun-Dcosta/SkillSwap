import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router';
import { changePasswordSchema } from '@skillswap/shared';
import {
  Button,
  Card,
  Input,
  Notice,
  SectionHeading,
  Tabs,
  tabPanelProps,
  useToast,
} from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  AvailabilityForm,
  BasicsForm,
  LearningForm,
  TeachingForm,
} from '@/features/profile/ProfileForms';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { usePageTitle } from '@/lib/hooks';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'teach', label: 'Teaching' },
  { id: 'learn', label: 'Learning' },
  { id: 'availability', label: 'Availability' },
  { id: 'account', label: 'Account' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function PasswordForm() {
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  return (
    <form
      noValidate
      className="flex max-w-md flex-col gap-4"
      onSubmit={handleSubmit(async (values) => {
        setFormError(null);
        try {
          await api.post('/auth/password', values);
          reset();
          toast.success('Password changed. Other devices have been signed out.');
        } catch (error) {
          setFormError(applyServerErrors(error, setError, ['currentPassword', 'newPassword']));
        }
      })}
    >
      {formError && <Notice>{formError}</Notice>}
      <Input
        label="Current password"
        type="password"
        autoComplete="current-password"
        error={errors.currentPassword?.message}
        {...register('currentPassword')}
      />
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 8 characters, with a letter and a number or symbol."
        error={errors.newPassword?.message}
        {...register('newPassword')}
      />
      <div>
        <Button type="submit" loading={isSubmitting}>
          Change password
        </Button>
      </div>
    </form>
  );
}

export default function SettingsPage() {
  usePageTitle('Settings');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : 'profile';
  if (!user) return null;

  return (
    <div className="container-page max-w-3xl py-8 sm:py-12">
      <SectionHeading
        as="h1"
        title="Settings"
        description="Changes are visible to other members right away."
      />
      <Tabs
        label="Settings sections"
        idBase="settings"
        tabs={TABS}
        value={tab}
        onChange={(id) => setParams({ tab: id }, { replace: true })}
        className="mt-6"
      />
      <Card className="mt-6" {...tabPanelProps('settings', tab)}>
        {tab === 'profile' && <BasicsForm />}
        {tab === 'teach' && <TeachingForm />}
        {tab === 'learn' && <LearningForm />}
        {tab === 'availability' && <AvailabilityForm />}
        {tab === 'account' && (
          <div className="flex flex-col gap-8">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted">Email</dt>
                <dd className="break-all font-semibold">{user.email}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Username</dt>
                <dd className="font-semibold">@{user.username}</dd>
              </div>
            </dl>
            <div>
              <h2 className="mb-4 text-lg font-bold">Change password</h2>
              {user.isDemo ? (
                <Notice tone="neutral">
                  Demo accounts share a password, so it cannot be changed here.
                </Notice>
              ) : (
                <PasswordForm />
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
