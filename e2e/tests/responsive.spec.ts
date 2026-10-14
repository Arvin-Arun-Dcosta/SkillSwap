import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { demoLogin, expectNoHorizontalOverflow, trackErrors } from './helpers';

const MEMBER_PAGES = [
  ['/dashboard', 'Hello, Elena'],
  ['/discover', 'Discover members'],
  ['/exchanges', 'Exchanges'],
  ['/exchanges?tab=contracts', 'Exchanges'],
  ['/sessions', 'Sessions'],
  ['/sessions?tab=past', 'Sessions'],
  ['/profile/alex', 'Alex Rivera'],
  ['/settings', 'Settings'],
  ['/settings?tab=teach', 'Settings'],
  ['/settings?tab=availability', 'Settings'],
  ['/onboarding', 'Review your profile'],
] as const;

test('every member page fits the screen, logs no errors and passes accessibility checks', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await demoLogin(page, /Elena Rostova/);

  for (const [url, heading] of MEMBER_PAGES) {
    await test.step(url, async () => {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
      await expect(page.getByRole('status', { name: /Loading/ })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      expect(
        results.violations.map(
          (v) => `${url} ${v.id}: ${v.help} (${v.nodes[0]?.target.join(' ')})`,
        ),
      ).toEqual([]);
    });
  }
  expect(errors).toEqual([]);
});

test('the learning room is usable at this screen size', async ({ page }) => {
  const errors = trackErrors(page);
  await demoLogin(page, /Arjun Mehta/);
  await page.goto('/session/SWAP-DEMO-ROOM');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Java collections and generics' }),
  ).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Call controls' })).toBeVisible();

  for (const tab of ['Code', 'Whiteboard', 'Notes', 'Files', 'Chat']) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click();
    await expect(page.getByRole('tabpanel')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  // Every tool stays reachable: the tab strip scrolls rather than pushing the page wider.
  await expect(page.getByRole('tab', { name: /Chat/ })).toBeInViewport();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    // The third-party editor manages its own focusable regions.
    .exclude('.cm-editor')
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes[0]?.target.join(' ')})`),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test('dialogs trap focus, close with Escape and return focus', async ({ page }) => {
  await demoLogin(page, /Alex Rivera/);
  await page.goto('/profile/marcus');
  const trigger = page.getByRole('button', { name: 'Propose an exchange' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: /Propose an exchange with Marcus/ });
  await expect(dialog).toBeVisible();
  // Focus starts inside the dialog and stays there while tabbing.
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    // Focus may pass through the browser's own controls, but never reaches the page behind.
    const escaped = await dialog.evaluate((el) => {
      const active = document.activeElement;
      return active !== null && active !== document.body && !el.contains(active);
    });
    expect(escaped).toBe(false);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
