import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  expect,
} from '@playwright/test';

export const PASSWORD = 'E2e-password-1';
let counter = 0;

export interface TestMember {
  name: string;
  username: string;
  context: BrowserContext;
  page: Page;
}

/** Fails the test if the page logs a console error or throws. Returns the collected messages. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`Uncaught: ${error.message}`));
  return errors;
}

async function post(
  request: APIRequestContext,
  url: string,
  data: unknown,
  method: 'post' | 'patch' = 'post',
) {
  const response = await request[method](url, { data });
  expect(
    response.ok(),
    `${method.toUpperCase()} ${url} -> ${response.status()} ${await response.text()}`,
  ).toBe(true);
  return response;
}

/**
 * Creates a member through the API (fast) with a finished profile, signed in inside their own
 * browser context so two members can be driven side by side.
 */
export async function createMember(
  browser: Browser,
  options: { name: string; teaches: string; wants: string },
): Promise<TestMember> {
  counter += 1;
  const username = `e2e_${Date.now().toString(36)}_${counter}_${Math.floor(Math.random() * 1e4)}`;
  const context = await browser.newContext();
  await post(context.request, '/api/auth/register', {
    name: options.name,
    username,
    email: `${username}@example.com`,
    password: PASSWORD,
  });
  await post(
    context.request,
    '/api/auth/me',
    {
      headline: `${options.name} teaches ${options.teaches}`,
      skillsTeaching: [
        { skill: options.teaches, proficiency: 'Expert', yearsExperience: 5, description: '' },
      ],
      skillsLearning: [
        { skill: options.wants, targetProficiency: 'Intermediate', priority: 'High', notes: '' },
      ],
      availability: { days: ['Monday', 'Saturday'], timeSlots: ['evening'], hoursPerWeek: 4 },
      preferences: { format: ['Video'], sessionLength: 60, languages: ['English'] },
      onboardingCompleted: true,
    },
    'patch',
  );
  const page = await context.newPage();
  return { name: options.name, username, context, page };
}

export async function demoLogin(page: Page, name: RegExp): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name }).click();
  await page.waitForURL(/\/(dashboard|admin)/);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, 'page should not scroll sideways').toBeLessThanOrEqual(0);
}
