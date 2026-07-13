import { expect, test, type Page } from '@playwright/test';

const apiBaseUrl = process.env.VITE_CUENOTE_API_BASE_URL ?? 'http://127.0.0.1:8080/api/v1';

test.describe('Phase 4 real backend integration', () => {
  test.skip(process.env.CUENOTE_REAL_BACKEND_E2E !== '1', 'Set CUENOTE_REAL_BACKEND_E2E=1 when the real backend is running.');

  test('publishes a bundled score, syncs queued annotations, verifies conflict handling, and isolates sign-out', async ({ page, request }) => {
    const { consoleErrors, pageErrors } = trackBrowserErrors(page);

    await page.goto('/');
    await page.getByTestId('dev-login').click();
    await expect(page.getByTestId('server-session-user')).toHaveText('phase4@cuenote.local');

    await page.getByTestId('server-ensemble-create').click();
    await expect(page.getByTestId('server-library-status')).toContainText(/ready|Ensemble/i);

    await page.getByTestId('publish-samples').click();
    await expect(page.getByTestId('server-score-list')).toContainText('Simple Duet');
    await expect(page.getByTestId('server-score-list')).toContainText('Lyrics and Chords');

    await page.getByTestId('server-score-list').getByRole('link', { name: /Simple Duet/ }).click();
    await page.waitForURL(/\/scores\/.+source=server&versionId=.+/);
    const currentUrl = new URL(page.url());
    const scoreId = currentUrl.pathname.split('/').pop()!;
    const versionId = currentUrl.searchParams.get('versionId')!;
    const session = await readSession(page);

    await expect(page.getByTestId('score-viewer-ready')).toBeVisible();
    await expect(page.getByTestId('annotation-overlay-ready')).toBeVisible();
    await expect(page.locator('[data-testid="score-renderer"] .score-page__surface > svg')).toHaveCount(1);
    await expect(page.getByTestId('current-measure-id')).toHaveText(new RegExp(`${scoreId}:p1:m1:`));

    await page.getByRole('button', { name: 'Annotate mode' }).click();
    await page.getByLabel('Tool').selectOption('PEN');
    await page.getByLabel('Scope').selectOption('ENSEMBLE');

    await page.context().setOffline(true);
    await drawOnFirstMeasure(page, scoreId);
    await expect(page.getByTestId('annotation-save-status')).toContainText(/queued/i);
    await expect(page.getByTestId('annotation-sync-status')).toContainText(/failed/i);
    await expect(page.getByTestId('annotation-sync-retry')).toBeVisible();

    await page.context().setOffline(false);
    await page.getByTestId('annotation-sync-retry').click();
    await expect(page.getByTestId('annotation-sync-status')).toContainText(/synced|up to date/i);

    const annotationsResponse = await request.get(`${apiBaseUrl}/scores/${scoreId}/annotations?scoreVersionId=${versionId}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    expect(annotationsResponse.ok()).toBeTruthy();
    const annotationsBody = await annotationsResponse.json();
    expect(annotationsBody.data.length).toBeGreaterThanOrEqual(1);

    const conflictAnnotationId = `e2e-conflict-${Date.now()}`;
    const firstMutation = await request.post(`${apiBaseUrl}/scores/${scoreId}/annotations/sync`, {
      headers: authJsonHeaders(session.accessToken),
      data: {
        scoreVersionId: versionId,
        mutations: [
          {
            clientMutationId: `${conflictAnnotationId}-create`,
            baseRevision: 0,
            action: 'UPSERT',
            annotation: textAnnotation(scoreId, versionId, conflictAnnotationId)
          }
        ]
      }
    });
    expect(firstMutation.ok()).toBeTruthy();
    const firstMutationBody = await firstMutation.json();
    expect(firstMutationBody.data.applied[0].revision).toBe(1);

    const staleMutation = await request.post(`${apiBaseUrl}/scores/${scoreId}/annotations/sync`, {
      headers: authJsonHeaders(session.accessToken),
      data: {
        scoreVersionId: versionId,
        mutations: [
          {
            clientMutationId: `${conflictAnnotationId}-stale`,
            baseRevision: 0,
            action: 'UPSERT',
            annotation: textAnnotation(scoreId, versionId, conflictAnnotationId)
          }
        ]
      }
    });
    expect(staleMutation.status()).toBe(409);
    const staleMutationBody = await staleMutation.json();
    expect(staleMutationBody.error.details.conflicts[0].serverRevision).toBe(1);

    await page.goto('/');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByTestId('dev-login')).toBeVisible();
    await page.goto(`/scores/${scoreId}?source=server&versionId=${versionId}`);
    await expect(page.getByTestId('score-viewer-error')).toContainText('Sign in from the library');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

async function drawOnFirstMeasure(page: Page, scoreId: string) {
  const measureLocator = page.locator(`[data-testid="score-renderer"] .score-page__surface svg [data-measure-id*="${scoreId}:p1:m1:"]`).first();
  await measureLocator.scrollIntoViewIfNeeded();
  const measureBox = await measureLocator.boundingBox();
  expect(measureBox).toBeTruthy();

  await page.mouse.move(measureBox!.x + 20, measureBox!.y + 20);
  await page.mouse.down();
  await page.mouse.move(measureBox!.x + measureBox!.width - 20, measureBox!.y + 20, { steps: 8 });
  await page.mouse.up();
}

async function readSession(page: Page): Promise<{ accessToken: string; user: { id: string; email: string } }> {
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

function textAnnotation(scoreId: string, versionId: string, id: string) {
  return {
    id,
    schemaVersion: 1,
    scoreId,
    scoreVersionId: versionId,
    type: 'TEXT',
    scope: 'ENSEMBLE',
    partId: null,
    anchor: { type: 'MEASURE', sourceMeasureId: `${scoreId}:p1:m1:m1` },
    payload: { text: 'conflict probe', x: 0.2, y: 0.2, width: 0.4, height: 0.12, fontSizeRatio: 0.1 },
    serverRevision: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function trackBrowserErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    const text = message.text();
    if (text.includes('Failed to load resource') || text.includes('ERR_INTERNET_DISCONNECTED')) {
      return;
    }
    consoleErrors.push(text);
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  return { consoleErrors, pageErrors };
}
