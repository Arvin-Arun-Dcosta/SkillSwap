import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, trackErrors } from './helpers';

test.describe('public pages', () => {
  test('landing page explains the product and passes automated accessibility checks', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Exchange');
    await expect(page.getByRole('link', { name: 'Create your profile' })).toBeVisible();
    await expect(page).toHaveTitle(/SkillSwap/);
    await expectNoHorizontalOverflow(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the skip link is the first stop for keyboard users', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });

  test('discover is browsable signed out, without invented match scores', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/discover');
    await expect(page.getByRole('heading', { name: 'Discover members' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rahul Verma' })).toBeVisible();
    await expect(page.getByText(/% match/)).toHaveCount(0);

    await page.getByRole('searchbox', { name: 'Search members' }).fill('figma');
    await expect(page.getByRole('heading', { name: 'Elena Rostova' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rahul Verma' })).toHaveCount(0);
    await expect(page).toHaveURL(/q=figma/);

    // Pattern characters are plain text to the search.
    await page.getByRole('searchbox', { name: 'Search members' }).fill('(.*');
    await expect(page.getByText('No members match those filters')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('unknown addresses get a real 404 page', async ({ page }) => {
    const response = await page.goto('/this-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'We could not find that page' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to the home page' }).click();
    await expect(page).toHaveURL('/');
  });

  test('protected pages send visitors to sign in and bring them back afterwards', async ({
    page,
  }) => {
    await page.goto('/exchanges');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Sign in to continue.')).toBeVisible();
    await page.getByRole('button', { name: /Arjun Mehta/ }).click();
    await expect(page).toHaveURL(/\/exchanges/);
    await expect(page.getByRole('heading', { name: 'Exchanges', level: 1 })).toBeVisible();
  });

  test('the theme toggle switches and remembers the colour theme', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    const before = await html.getAttribute('data-theme');
    await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click();
    const after = await html.getAttribute('data-theme');
    expect(after).not.toBe(before);
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', after ?? '');
  });

  test('search engines get robots.txt, a sitemap and per-profile metadata', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(await robots.text()).toContain('Sitemap:');
    const sitemap = await request.get('/sitemap.xml');
    expect(await sitemap.text()).toContain('/profile/rahul');
    const profile = await (await request.get('/profile/rahul')).text();
    expect(profile).toContain('<title>Rahul Verma (@rahul) on SkillSwap</title>');
    expect(profile).toContain('rel="canonical"');
  });
});
