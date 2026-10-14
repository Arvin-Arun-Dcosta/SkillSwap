import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  PASSWORD,
  createMember,
  demoLogin,
  expectNoHorizontalOverflow,
  trackErrors,
} from './helpers';

test('a report filed from a profile reaches moderation and suspension takes effect at once', async ({
  browser,
  page,
}) => {
  const reporter = await createMember(browser, {
    name: 'Rita Reporter',
    teaches: 'Pottery',
    wants: 'Welding',
  });
  const target = await createMember(browser, {
    name: 'Sam Spammer',
    teaches: 'Welding',
    wants: 'Pottery',
  });

  await test.step('a member reports another from their profile', async () => {
    await reporter.page.goto(`/profile/${target.username}`);
    await reporter.page.getByRole('button', { name: 'More actions for Sam Spammer' }).click();
    await reporter.page.getByRole('button', { name: 'Report this member' }).click();
    const dialog = reporter.page.getByRole('dialog', { name: 'Report Sam Spammer' });
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog.getByText('Pick a reason')).toBeVisible();
    await dialog.getByLabel('Reason').selectOption('Spam or Solicitation');
    await dialog.getByLabel('What happened').fill('Keeps sending links to a paid course in chat.');
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(reporter.page.getByText('Report sent.')).toBeVisible();
  });

  await test.step('members cannot open moderation', async () => {
    await reporter.page.goto('/admin');
    await expect(
      reporter.page.getByRole('heading', { name: 'We could not find that page' }),
    ).toBeVisible();
  });

  const errors = trackErrors(page);
  await test.step('the administrator sees real numbers and the report', async () => {
    await demoLogin(page, /Demo Admin/);
    await expect(page.getByRole('heading', { level: 1, name: 'Moderation' })).toBeVisible();
    await expect(page.getByText('Activity, last 14 days')).toBeVisible();
    // Each chart is one keyboard stop: a slider whose arrow keys read out the days.
    const slider = page.getByRole('slider', { name: 'Sign-ups: day' });
    await slider.focus();
    await expect(slider).toHaveAttribute('aria-valuetext', /sign-ups?$/);
    const today = await slider.getAttribute('aria-valuetext');
    await page.keyboard.press('ArrowLeft');
    await expect(slider).not.toHaveAttribute('aria-valuetext', today ?? '');
    await expectNoHorizontalOverflow(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes[0]?.target.join(' ')})`),
    ).toEqual([]);

    await page.getByRole('tab', { name: 'Reports' }).click();
    const card = page
      .getByRole('listitem')
      .filter({ hasText: 'Keeps sending links to a paid course' });
    await expect(card).toContainText('Sam Spammer');
    await expect(card).toContainText('Rita Reporter');
    await card.getByRole('button', { name: 'Suspend member' }).click();
    await page
      .getByRole('dialog', { name: 'Suspend Sam Spammer?' })
      .getByRole('button', { name: 'Suspend member' })
      .click();
    await expect(page.getByText('Report updated.')).toBeVisible();
    await expect(card).toContainText('Member suspended');
  });

  await test.step('the suspended member is signed out and cannot sign back in', async () => {
    await target.page.goto('/dashboard');
    await expect(target.page).toHaveURL(/\/login/);
    await target.page.getByLabel('Email or username').fill(target.username);
    await target.page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await target.page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(target.page.getByRole('alert')).toContainText('suspended');
  });

  await test.step('the administrator can find and reinstate them', async () => {
    await page.getByRole('tab', { name: 'Members' }).click();
    await page.getByRole('searchbox', { name: 'Search members' }).fill(target.username);
    const row = page.getByRole('listitem').filter({ hasText: 'Sam Spammer' });
    await expect(row).toContainText('Suspended');
    await row.getByRole('button', { name: /Reinstate/ }).click();
    await page
      .getByRole('dialog', { name: 'Reinstate Sam Spammer?' })
      .getByRole('button', { name: 'Reinstate member' })
      .click();
    await expect(row).toContainText('Active');
  });

  expect(errors).toEqual([]);
  await Promise.all([reporter.context.close(), target.context.close()]);
});
