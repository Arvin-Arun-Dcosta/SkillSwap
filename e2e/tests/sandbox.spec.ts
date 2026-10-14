import { type Page, expect, test } from '@playwright/test';
import { demoLogin, trackErrors } from './helpers';

async function runCode(page: Page, code: string): Promise<string> {
  const editor = page.getByRole('textbox', { name: 'Shared code editor' });
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(code);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const output = page.getByRole('region', { name: 'Program output' });
  await expect(output).toBeVisible({ timeout: 15_000 });
  return (await output.innerText()).replace(/^Output\s*Clear\s*/, '');
}

test.describe('code sandbox', () => {
  test.describe.configure({ mode: 'serial' });

  test('code in the shared editor cannot reach the member’s session, storage or the network', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await demoLogin(page, /Rahul Verma/);
    await page.goto('/session/SWAP-DEMO-ROOM');
    await expect(page.getByRole('textbox', { name: 'Shared code editor' })).toBeVisible();

    const probe = await runCode(
      page,
      [
        'const report = {};',
        'report.origin = self.origin || String(self.location.origin);',
        'report.cookie = typeof document;',
        'report.storage = typeof localStorage;',
        'report.parent = typeof parent;',
        'fetch("/api/auth/me").then(() => console.log("FETCH-SUCCEEDED"), (e) => console.log("fetch blocked"));',
        'console.log(JSON.stringify(report));',
      ].join('\n'),
    );
    // Opaque origin, no DOM, no storage, no window.
    expect(probe).toContain('"origin":"null"');
    expect(probe).toContain('"cookie":"undefined"');
    expect(probe).toContain('"storage":"undefined"');
    expect(probe).toContain('"parent":"undefined"');
    expect(probe).not.toContain('FETCH-SUCCEEDED');

    const maths = await runCode(page, 'console.log([1, 2, 3].map((n) => n * n));\n"done"');
    expect(maths).toContain('1,');
    expect(maths).toContain('← done');

    const thrown = await runCode(page, 'null.boom');
    expect(thrown).toMatch(/TypeError/);

    // The policy violation from the blocked fetch is the sandbox doing its job, inside the frame.
    expect(
      errors.filter((e) => !/Content Security Policy|connect-src|Refused to connect/i.test(e)),
    ).toEqual([]);
  });

  test('an endless loop is stopped instead of freezing the page', async ({ page }) => {
    await demoLogin(page, /Rahul Verma/);
    await page.goto('/session/SWAP-DEMO-ROOM');
    const result = await runCode(page, 'while (true) {}');
    expect(result).toContain('Stopped after 5 seconds');
    // The page is still responsive.
    await page.getByRole('tab', { name: /Notes/ }).click();
    await expect(page.getByLabel('Session notes')).toBeVisible();
  });
});
