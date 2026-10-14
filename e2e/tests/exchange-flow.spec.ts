import { type Page, expect, test } from '@playwright/test';
import { createMember, trackErrors } from './helpers';

/** True once the element with this label is playing a stream that carries live video. */
async function hasLiveVideo(page: Page, label: string): Promise<boolean> {
  return page.getByLabel(label).evaluate((element) => {
    const video = element as HTMLVideoElement;
    const stream = video.srcObject as MediaStream | null;
    return (
      Boolean(stream?.getVideoTracks().some((t) => t.readyState === 'live')) && video.videoWidth > 0
    );
  });
}

test('two members negotiate an exchange, meet in a learning room and review each other', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const ana = await createMember(browser, {
    name: 'Ana Flores',
    teaches: 'Watercolour',
    wants: 'Bookbinding',
  });
  const ben = await createMember(browser, {
    name: 'Ben Okoro',
    teaches: 'Bookbinding',
    wants: 'Watercolour',
  });
  const anaErrors = trackErrors(ana.page);
  const benErrors = trackErrors(ben.page);

  await test.step('Ana finds Ben, sees why they match, and proposes', async () => {
    await ana.page.goto(`/profile/${ben.username}`);
    await expect(ana.page.getByRole('heading', { name: /Your match: 100%/ })).toBeVisible();
    await expect(
      ana.page.getByText('Two-way swap: you teach Watercolour, they teach Bookbinding'),
    ).toBeVisible();
    await ana.page.getByRole('button', { name: 'Propose an exchange' }).click();

    const dialog = ana.page.getByRole('dialog', { name: /Propose an exchange with Ben/ });
    await expect(dialog.getByLabel('You teach')).toHaveValue('Watercolour');
    await expect(dialog.getByLabel('Ben teaches')).toHaveValue('Bookbinding');
    await dialog.getByRole('button', { name: 'Send proposal' }).click();
    await expect(dialog.getByText(/at least 10 characters/)).toBeVisible();
    await dialog
      .getByLabel('Your note')
      .fill('I would love to learn bookbinding. Happy to teach washes and layering.');
    await dialog.getByLabel('Number of sessions').selectOption('2');
    await dialog.getByLabel('Add a goal').fill('Bind one small notebook');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await dialog.getByRole('button', { name: 'Send proposal' }).click();
    await expect(ana.page.getByText('Proposal sent to Ben.')).toBeVisible();
    await expect(ana.page.getByRole('link', { name: 'View your exchange' })).toBeVisible();
  });

  await test.step('Ben is notified and suggests different terms', async () => {
    await ben.page.goto('/dashboard');
    await expect(ben.page.getByRole('button', { name: /Notifications, 1 unread/ })).toBeVisible();
    await ben.page.goto('/exchanges');
    await expect(ben.page.getByText('Your reply needed')).toBeVisible();
    await ben.page.getByRole('button', { name: 'Suggest changes' }).click();
    const dialog = ben.page.getByRole('dialog', { name: 'Suggest different terms' });
    await dialog.getByLabel('Number of sessions').fill('1');
    await dialog.getByLabel('When works for you').fill('Saturday mornings');
    await dialog
      .getByLabel('Why the change')
      .fill('Can we start with a single session and see how it goes?');
    await dialog.getByRole('button', { name: 'Send counter-offer' }).click();
    await expect(ben.page.getByText('Counter-offer sent.')).toBeVisible();
    // Ben made the latest offer, so he can withdraw it but not accept it.
    await expect(ben.page.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
    await expect(ben.page.getByRole('button', { name: 'Withdraw offer' })).toBeVisible();
  });

  await test.step('Ana accepts the counter-offer and gets a contract with the countered terms', async () => {
    await ana.page.goto('/exchanges?tab=sent');
    await expect(ana.page.getByText("Ben's counter-offer")).toBeVisible();
    await expect(ana.page.getByText('1 session', { exact: true })).toBeVisible();
    await ana.page.getByRole('button', { name: 'Accept counter-offer' }).click();

    const contract = ana.page.getByRole('dialog', { name: 'Learning contract' });
    await expect(contract.getByText('0 of 1 sessions completed')).toBeVisible();
    await expect(contract.getByText('Saturday mornings')).toBeVisible();
    await contract.getByLabel('Bind one small notebook').check();
    await expect(contract.getByText('(1 of 1 done)')).toBeVisible();
  });

  await test.step('Ana schedules the session', async () => {
    const contract = ana.page.getByRole('dialog', { name: 'Learning contract' });
    await contract.getByRole('button', { name: 'Schedule a session' }).click();
    const dialog = ana.page.getByRole('dialog', { name: 'Schedule a session' });
    await dialog
      .getByLabel('What this session covers')
      .selectOption({ label: 'Bookbinding (Ben teaches)' });
    await dialog.getByLabel('Title').fill('Bookbinding basics');
    await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(ana.page.getByText(/Session scheduled/)).toBeVisible();
  });

  await test.step('both open the room and the call connects', async () => {
    await ana.page.goto('/sessions');
    await ana.page.getByRole('link', { name: /Open room/ }).click();
    await expect(ana.page).toHaveURL(/\/session\/SWAP-/);
    await expect(
      ana.page.getByRole('status').filter({ hasText: 'Waiting for Ben to join' }).first(),
    ).toBeVisible();

    await ben.page.goto('/sessions');
    await ben.page.getByRole('link', { name: /Join now|Open room/ }).click();

    for (const { page, partner } of [
      { page: ana.page, partner: 'Ben Okoro' },
      { page: ben.page, partner: 'Ana Flores' },
    ]) {
      await expect(page.getByRole('status').filter({ hasText: 'Connected' }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(() => hasLiveVideo(page, `${partner}'s video`), { timeout: 20_000 })
        .toBe(true);
    }

    // Muting is visible to the other side.
    await ana.page.getByRole('button', { name: 'Mute microphone' }).click();
    await expect(ben.page.getByText('Ana is muted')).toBeVisible();
    await ana.page.getByRole('button', { name: 'Unmute microphone' }).click();
    await expect(ben.page.getByText('Ana is muted')).toHaveCount(0);
  });

  await test.step('code typed by one appears for the other and runs in the sandbox', async () => {
    const editor = ana.page.getByRole('textbox', { name: 'Shared code editor' });
    await editor.click();
    await ana.page.keyboard.insertText('console.log("stitches:", 6 * 7);');
    // Wait for the whole line to arrive before the second person starts typing.
    await expect(ben.page.getByRole('textbox', { name: 'Shared code editor' })).toContainText(
      'console.log("stitches:", 6 * 7);',
    );

    // Both type at once; nothing is lost.
    await ben.page.getByRole('textbox', { name: 'Shared code editor' }).click();
    await ben.page.keyboard.press('Control+End');
    await ben.page.keyboard.press('Enter');
    await ben.page.keyboard.insertText('console.log("from ben");');
    await expect(editor).toContainText('from ben');
    await expect(editor).toContainText('stitches');

    await ben.page.getByRole('button', { name: 'Run', exact: true }).click();
    const output = ben.page.getByRole('region', { name: 'Program output' });
    await expect(output).toContainText('stitches: 42');
    await expect(output).toContainText('from ben');

    // Changing the language is shared too, and non-runnable languages say so.
    await ben.page.getByLabel('Language').selectOption('python');
    await expect(ana.page.getByLabel('Language')).toHaveValue('python');
    await expect(ana.page.getByText(/Python is highlighted but cannot be run here/)).toBeVisible();
    await expect(ana.page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  });

  await test.step('notes, whiteboard and chat are shared', async () => {
    await ana.page.getByRole('tab', { name: /Notes/ }).click();
    await ana.page.getByLabel('Session notes').fill('Tools: awl, bone folder, waxed thread');
    await ben.page.getByRole('tab', { name: /Notes/ }).click();
    await expect(ben.page.getByLabel('Session notes')).toHaveValue(
      'Tools: awl, bone folder, waxed thread',
    );
    await ben.page.getByLabel('Session notes').press('End');
    await ben.page.getByLabel('Session notes').pressSequentially(' + PVA glue');
    await expect(ana.page.getByLabel('Session notes')).toHaveValue(
      'Tools: awl, bone folder, waxed thread + PVA glue',
    );

    await ana.page.getByRole('tab', { name: /Whiteboard/ }).click();
    const board = ana.page.getByRole('img', { name: /Shared whiteboard/ });
    const box = await board.boundingBox();
    if (!box) throw new Error('whiteboard not visible');
    await ana.page.mouse.move(box.x + 40, box.y + 40);
    await ana.page.mouse.down();
    await ana.page.mouse.move(box.x + 160, box.y + 120, { steps: 8 });
    await ana.page.mouse.up();
    await ben.page.getByRole('tab', { name: /Whiteboard/ }).click();
    await expect(
      ben.page.getByRole('img', { name: /Shared whiteboard with 1 stroke\./ }),
    ).toBeVisible();

    await ben.page.getByRole('tab', { name: /Chat/ }).click();
    await ben.page
      .getByRole('textbox', { name: 'Message' })
      .fill('Here is the thread I use: https://example.com/thread');
    await ben.page.getByRole('button', { name: 'Send message' }).click();
    // Ana is on another tab and sees an unread count, then the message.
    await expect(ana.page.getByRole('tab', { name: /Chat/ })).toContainText('1');
    await ana.page.getByRole('tab', { name: /Chat/ }).click();
    await expect(ana.page.getByRole('log')).toContainText('Here is the thread I use');
  });

  await test.step('a shared file can be downloaded by the partner only', async () => {
    await ana.page.getByRole('tab', { name: /Files/ }).click();
    await ana.page.locator('input[type=file]').setInputFiles({
      name: 'evil.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<script>alert(1)</script>'),
    });
    await expect(ana.page.getByText(/\.html files cannot be shared/)).toBeVisible();
    await ana.page.locator('input[type=file]').setInputFiles({
      name: 'materials.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('awl, thread, paper'),
    });
    await expect(ana.page.getByText('File shared.')).toBeVisible();

    await ben.page.getByRole('tab', { name: /Files/ }).click();
    await expect(ben.page.getByText('materials.txt')).toBeVisible();
    const download = ben.page.waitForEvent('download');
    await ben.page.getByRole('link', { name: 'Download materials.txt' }).click();
    expect((await download).suggestedFilename()).toBe('materials.txt');
  });

  await test.step('ending the session works and leads to reviews', async () => {
    await ana.page.getByRole('button', { name: 'End session' }).click();
    const confirm = ana.page.getByRole('dialog', { name: 'End this session for both of you?' });
    await confirm.getByRole('button', { name: 'End session' }).click();

    // The page keeps working after the session ends.
    const review = ana.page.getByRole('dialog', { name: 'Review Ben Okoro' });
    await expect(review).toBeVisible();
    await review.getByRole('button', { name: 'Submit review' }).click();
    await expect(review.getByText('Choose a rating from 1 to 5 stars.')).toBeVisible();
    await review.getByText('5 stars: Excellent').click({ force: true });
    await review
      .getByLabel('What stood out')
      .fill('Patient teacher, and I left with a finished notebook.');
    await review.getByRole('button', { name: 'Submit review' }).click();
    await expect(ana.page).toHaveURL(/\/sessions\?tab=past/);
    await expect(ana.page.getByText('You reviewed this session.')).toBeVisible();

    // Ben is told the session ended and reviews Ana in turn.
    await expect(ben.page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
    await ben.page.getByRole('button', { name: 'Review Ana' }).click();
    const benReview = ben.page.getByRole('dialog', { name: 'Review Ana Flores' });
    await benReview.getByText('4 stars: Very good').click({ force: true });
    await benReview.getByRole('button', { name: 'Submit review' }).click();
    await expect(ben.page).toHaveURL(/\/sessions\?tab=past/);
  });

  await test.step('reputation and the contract reflect what happened', async () => {
    await ana.page.goto(`/profile/${ben.username}`);
    await expect(
      ana.page.getByText('Patient teacher, and I left with a finished notebook.'),
    ).toBeVisible();
    await expect(ana.page.getByText('Taught Bookbinding')).toBeVisible();
    const reputation = ana.page
      .locator('aside')
      .getByRole('heading', { name: 'Reputation' })
      .locator('..');
    await expect(reputation).toContainText('5.0');
    await expect(reputation).toContainText('First swap');

    await ana.page.goto('/exchanges?tab=contracts');
    await expect(ana.page.getByText('1 of 1 session completed')).toBeVisible();
    await expect(ana.page.getByText('Completed', { exact: true })).toBeVisible();

    // The notes survive the session.
    await ana.page.goto('/sessions?tab=past');
    await expect(ana.page.getByText('Bookbinding basics')).toBeVisible();
  });

  expect(anaErrors).toEqual([]);
  expect(benErrors).toEqual([]);
  await ana.context.close();
  await ben.context.close();
});

test('a session nobody else joined does not count and cannot be reviewed', async ({ browser }) => {
  const ana = await createMember(browser, { name: 'Cleo Park', teaches: 'Chess', wants: 'Guitar' });
  const ben = await createMember(browser, { name: 'Dev Shah', teaches: 'Guitar', wants: 'Chess' });

  // Set the exchange up through the API; this test is about the room.
  const proposal = await ana.context.request.post('/api/exchanges', {
    data: {
      receiverId: (
        (await (await ben.context.request.get('/api/auth/me')).json()) as { user: { id: string } }
      ).user.id,
      teachingSkill: 'Chess',
      learningSkill: 'Guitar',
      message: 'Shall we trade chess openings for guitar chords?',
      sessions: 1,
      durationMinutes: 30,
    },
  });
  const exchange = ((await proposal.json()) as { exchange: { id: string } }).exchange;
  const accepted = await ben.context.request.post(`/api/exchanges/${exchange.id}/action`, {
    data: { action: 'accept' },
  });
  const contractId = ((await accepted.json()) as { exchange: { contractId: string } }).exchange
    .contractId;
  const scheduled = await ana.context.request.post('/api/sessions', {
    data: {
      contractId,
      skill: 'Chess',
      scheduledStartTime: new Date(Date.now() + 3600_000).toISOString(),
    },
  });
  const { roomCode } = ((await scheduled.json()) as { session: { roomCode: string } }).session;

  await ana.page.goto(`/session/${roomCode}`);
  await expect(
    ana.page.getByRole('status').filter({ hasText: 'Waiting for Dev to join' }).first(),
  ).toBeVisible();

  // Someone who is not part of the session cannot even see that it exists.
  const outsider = await createMember(browser, {
    name: 'Eve Outsider',
    teaches: 'Lockpicking',
    wants: 'Chess',
  });
  const response = await outsider.page.goto(`/session/${roomCode}`);
  expect(response?.status()).toBe(200);
  await expect(
    outsider.page.getByRole('heading', { name: 'We could not find that page' }),
  ).toBeVisible();

  await ana.page.getByRole('button', { name: 'End session' }).click();
  const confirm = ana.page.getByRole('dialog', { name: 'End this session for both of you?' });
  await expect(confirm).toContainText('Dev has not joined');
  await confirm.getByRole('button', { name: 'End session' }).click();
  await expect(ana.page).toHaveURL(/\/sessions$/);

  await ana.page.goto('/sessions?tab=past');
  await expect(ana.page.getByText('Cancelled', { exact: true })).toBeVisible();
  await expect(ana.page.getByRole('button', { name: /Review/ })).toHaveCount(0);
  await ana.page.goto('/dashboard');
  await expect(ana.page.getByText('Sessions completed').locator('..')).toContainText('0');

  await Promise.all([ana.context.close(), ben.context.close(), outsider.context.close()]);
});
