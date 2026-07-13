import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiBaseUrl = process.env.VITE_CUENOTE_API_BASE_URL ?? 'http://127.0.0.1:8080/api/v1';

test.describe('Phase 5 real rehearsal sync', () => {
  test.skip(process.env.CUENOTE_REAL_REHEARSAL_E2E !== '1', 'Set CUENOTE_REAL_REHEARSAL_E2E=1 when the real backend is running.');

  test('syncs leader playback to a second browser context over the real WebSocket endpoint', async ({ page, browser, request }) => {
    const leaderErrors = trackBrowserErrors(page);
    const followerContext = await browser.newContext();
    const followerPage = await followerContext.newPage();
    const followerErrors = trackBrowserErrors(followerPage);

    await page.goto('/');
    await page.getByTestId('dev-login').click();
    await page.getByTestId('server-ensemble-create').click();
    await page.getByTestId('publish-samples').click();
    await expect(page.getByTestId('server-score-list')).toContainText('Simple Duet');

    const leaderSession = await readSession(page);
    const ensembles = await apiGet(request, '/ensembles', leaderSession.accessToken);
    const ensembleId = ensembles[0].id;
    const scores = await apiGet(request, `/ensembles/${ensembleId}/scores`, leaderSession.accessToken);
    const score = scores.find((item: { title: string }) => item.title === 'Simple Duet') ?? scores[0];

    const followerSessionResponse = await request.post(`${apiBaseUrl}/dev-auth/login`, {
      data: { email: `phase5-follower-${Date.now()}@cuenote.local`, displayName: 'Phase 5 Follower' }
    });
    expect(followerSessionResponse.ok()).toBeTruthy();
    const followerSession = (await followerSessionResponse.json()).data;
    await request.post(`${apiBaseUrl}/ensembles/${ensembleId}/members`, {
      headers: authJsonHeaders(leaderSession.accessToken),
      data: { userId: followerSession.user.id, role: 'MEMBER' }
    });

    const scoreUrl = `/scores/${score.id}?source=server&versionId=${score.current_version_id}`;
    await page.goto(scoreUrl);
    await expect(page.getByTestId('score-viewer-ready')).toBeVisible();
    await page.getByTestId('rehearsal-create').click();
    await expect(page.getByTestId('rehearsal-connection')).toHaveText(/CONNECTED|CONNECTING|RECONNECTING/);
    await expect(page.getByTestId('rehearsal-connection')).toHaveText('CONNECTED');

    await followerPage.addInitScript((session) => {
      window.localStorage.setItem('cuenote.phase4.session', JSON.stringify(session));
    }, followerSession);
    await followerPage.goto(scoreUrl);
    await expect(followerPage.getByTestId('score-viewer-ready')).toBeVisible();
    await followerPage.getByTestId('rehearsal-refresh').click();
    await followerPage.getByTestId('rehearsal-session-select').selectOption({ index: 1 });
    await followerPage.getByTestId('rehearsal-join').click();
    await expect(followerPage.getByTestId('rehearsal-connection')).toHaveText('CONNECTED');

    await page.getByTestId('rehearsal-play').click();
    await expect(followerPage.getByTestId('rehearsal-shared-measure')).not.toHaveText('none');
    await expect(followerPage.getByTestId('playback-status')).toHaveText(/PLAYING|COUNT_IN/);
    await expect(followerPage.getByTestId('current-performance-measure-id')).toHaveText(await page.getByTestId('current-performance-measure-id').innerText());

    await followerPage.getByTestId('rehearsal-browse').click();
    await expect(followerPage.getByTestId('rehearsal-follow-mode')).toHaveText('BROWSING_INDEPENDENTLY');
    await followerPage.getByTestId('next-measure').click();
    await followerPage.getByTestId('rehearsal-return-to-leader').click();
    await expect(followerPage.getByTestId('rehearsal-follow-mode')).toHaveText('FOLLOWING_LEADER');

    await page.getByTestId('rehearsal-pause').click();
    await expect(followerPage.getByTestId('playback-status')).toHaveText('PAUSED');
    await page.getByTestId('rehearsal-end').click();
    await expect(page.getByTestId('rehearsal-status')).toContainText(/ended/i);

    expect(leaderErrors.consoleErrors).toEqual([]);
    expect(leaderErrors.pageErrors).toEqual([]);
    expect(followerErrors.consoleErrors).toEqual([]);
    expect(followerErrors.pageErrors).toEqual([]);
    await followerContext.close();
  });
});

async function apiGet(request: APIRequestContext, path: string, accessToken: string) {
  const response = await request.get(`${apiBaseUrl}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}

async function readSession(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('cuenote.phase4.session');
    if (!raw) {
      throw new Error('Server session was not stored.');
    }
    return JSON.parse(raw);
  });
}

function authJsonHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
}

function trackBrowserErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}
