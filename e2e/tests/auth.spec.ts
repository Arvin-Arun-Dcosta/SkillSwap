import { expect, test } from '@playwright/test';
import { PASSWORD, demoLogin, trackErrors } from './helpers';

test('a new member can sign up, complete onboarding and sign back in', async ({ page }) => {
  const errors = trackErrors(page);
  const username = `new_${Date.now().toString(36)}`;

  await page.goto('/register');
  // Validation is shown inline before anything is sent.
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Name is required')).toBeVisible();

  await page.getByLabel('Name', { exact: true }).fill('Priya Sharma');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(`${username}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Use at least 8 characters')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Step 1: about you. Nobody else's details are pre-filled.
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
  await expect(page.getByLabel('Headline')).toHaveValue('');
  await page.getByLabel('Headline').fill('Learning in public');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // Step 2: teaching starts empty and cannot be skipped empty.
  await expect(page.getByRole('heading', { name: 'What you teach' })).toBeVisible();
  await expect(page.getByText('Nothing here yet')).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Add at least one skill you can teach.')).toBeVisible();
  await page.getByLabel('Skill', { exact: true }).fill('Spanish');
  await page.getByLabel('Your level').selectOption('Advanced');
  await page.getByRole('button', { name: 'Add skill' }).click();
  await expect(page.getByText('Spanish')).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // Step 3: a filled-in row is included without pressing "Add".
  await expect(page.getByRole('heading', { name: 'What you want to learn' })).toBeVisible();
  await page.getByLabel('Skill', { exact: true }).fill('Python');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // Step 4: availability and preferences.
  await expect(page.getByRole('heading', { name: 'When and how' })).toBeVisible();
  await page.getByText('Saturday', { exact: true }).click();
  await page.getByText('Evenings').click();
  await page.getByRole('button', { name: 'Finish and find partners' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Hello, Priya' })).toBeVisible();
  // A new member has no invented reputation.
  await expect(page.getByText('No reviews yet').first()).toBeVisible();
  await expect(page.getByText('Sessions completed').locator('..')).toContainText('0');

  // Sign out, then back in with the wrong and the right password.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/login');
  await page.getByLabel('Email or username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('incorrect');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // The failed sign-in is the only request allowed to fail.
  expect(errors.filter((e) => !e.includes('401'))).toEqual([]);
});

test('settings can be edited without redoing onboarding', async ({ page }) => {
  await demoLogin(page, /Elena Rostova/);
  await page.goto('/settings');
  await page.getByLabel('Location').fill('Hamburg, Germany');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  await page.goto('/profile/elena');
  await expect(page.getByText('Hamburg, Germany')).toBeVisible();
  // Email is never part of a public profile.
  await expect(page.getByText('elena@example.com')).toHaveCount(0);
});
