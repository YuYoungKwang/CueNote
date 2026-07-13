import { expect, test, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sampleXml = fs.readFileSync(path.resolve('src/samples/simple-duet.musicxml'), 'utf-8');

test('opens a server score and retries queued annotation sync after a network failure', async ({ page }) => {
  const { consoleErrors, pageErrors } = trackBrowserErrors(page);
  let syncAttempts = 0;
  await installPhase4ApiMock(page, () => syncAttempts++);

  await page.goto('/');
  await page.getByTestId('dev-login').click();
  await expect(page.getByTestId('server-session-user')).toHaveText('phase4@cuenote.local');
  await page.getByTestId('server-ensemble-create').click();
  await expect(page.getByTestId('server-library-status')).toContainText(/ready|Ensemble/i);
  await page.getByTestId('publish-samples').click();
  await expect(page.getByTestId('server-score-list')).toContainText('Simple Duet');

  await page.getByTestId('server-score-list').getByRole('link', { name: /Simple Duet/ }).click();
  await page.waitForURL('**/scores/scr_simple?source=server&versionId=ver_simple');
  await expect(page.getByTestId('score-viewer-ready')).toBeVisible();
  await expect(page.getByTestId('annotation-overlay-ready')).toBeVisible();
  await expect(page.locator('[data-testid="score-renderer"] .score-page__surface > svg')).toHaveCount(1);
  await expect(page.getByTestId('current-measure-id')).toHaveText(/scr_simple:p1:m1:/);

  await page.getByRole('button', { name: 'Annotate mode' }).click();
  await page.getByLabel('Tool').selectOption('PEN');
  await page.getByLabel('Scope').selectOption('ENSEMBLE');

  const measureLocator = page.locator('[data-testid="score-renderer"] .score-page__surface svg [data-measure-id*="scr_simple:p1:m1:"]').first();
  await measureLocator.scrollIntoViewIfNeeded();
  const measureBox = await measureLocator.boundingBox();
  expect(measureBox).toBeTruthy();

  await page.mouse.move(measureBox!.x + 20, measureBox!.y + 20);
  await page.mouse.down();
  await page.mouse.move(measureBox!.x + measureBox!.width - 20, measureBox!.y + 20, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId('annotation-save-status')).toContainText(/queued/i);
  await expect(page.getByTestId('annotation-sync-status')).toContainText(/failed/i);
  await expect(page.getByTestId('annotation-sync-retry')).toBeVisible();

  await page.getByTestId('annotation-sync-retry').click();
  await expect(page.getByTestId('annotation-sync-status')).toContainText(/synced|up to date/i);
  await expect.poll(async () => syncAttempts).toBeGreaterThanOrEqual(2);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

async function installPhase4ApiMock(page: Page, onSyncAttempt: () => number) {
  await page.route('http://127.0.0.1:8080/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathName = url.pathname.replace('/api/v1', '');

    if (pathName === '/dev-auth/login' && request.method() === 'POST') {
      await json(route, {
        user: { id: 'usr_phase4', email: 'phase4@cuenote.local', displayName: 'Phase 4 Tester' },
        accessToken: 'ct_access_test',
        refreshToken: 'ct_refresh_test',
        accessTokenExpiresAt: '2026-07-13T10:00:00Z',
        refreshTokenExpiresAt: '2026-07-27T10:00:00Z'
      });
      return;
    }

    if (pathName === '/ensembles' && request.method() === 'GET') {
      await json(route, [{ id: 'ens_phase4', name: 'Phase 4 Ensemble', role: 'OWNER' }]);
      return;
    }

    if (pathName === '/ensembles' && request.method() === 'POST') {
      await json(route, { id: 'ens_phase4', name: 'Phase 4 Ensemble', role: 'OWNER' });
      return;
    }

    if (pathName === '/ensembles/ens_phase4/scores' && request.method() === 'GET') {
      await json(route, [
        {
          id: 'scr_simple',
          ensemble_id: 'ens_phase4',
          title: 'Simple Duet',
          composer: 'CueNote Team',
          current_version_id: 'ver_simple',
          current_version_number: 1
        },
        {
          id: 'scr_lyrics',
          ensemble_id: 'ens_phase4',
          title: 'Lyrics and Chords',
          composer: 'CueNote Team',
          current_version_id: 'ver_lyrics',
          current_version_number: 1
        }
      ]);
      return;
    }

    if (pathName === '/ensembles/ens_phase4/scores' && request.method() === 'POST') {
      await json(route, {
        id: 'scr_simple',
        ensemble_id: 'ens_phase4',
        title: 'Simple Duet',
        composer: 'CueNote Team',
        current_version_id: 'ver_simple',
        versions: [{ id: 'ver_simple', score_id: 'scr_simple', version_number: 1, title: 'Simple Duet' }]
      });
      return;
    }

    if (pathName === '/scores/scr_simple' && request.method() === 'GET') {
      await json(route, {
        id: 'scr_simple',
        ensemble_id: 'ens_phase4',
        title: 'Simple Duet',
        composer: 'CueNote Team',
        current_version_id: 'ver_simple',
        versions: [{ id: 'ver_simple', score_id: 'scr_simple', version_number: 1, title: 'Simple Duet' }]
      });
      return;
    }

    if (pathName === '/scores/scr_simple/versions/ver_simple/source' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: sampleXml
      });
      return;
    }

    if (pathName === '/scores/scr_simple/annotations' && request.method() === 'GET') {
      await json(route, []);
      return;
    }

    if (pathName === '/scores/scr_simple/annotations/sync' && request.method() === 'POST') {
      const attempt = onSyncAttempt();
      const body = request.postDataJSON() as { mutations: Array<{ clientMutationId: string; annotation: unknown }> };
      if (attempt === 0) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'TEMPORARY_FAILURE', message: 'Temporary sync failure.', details: {} },
            meta: { requestId: 'req_mock' }
          })
        });
        return;
      }

      const mutation = body.mutations[0];
      await json(route, {
        applied: [
          {
            clientMutationId: mutation.clientMutationId,
            annotationId: (mutation.annotation as { id: string }).id,
            revision: 1,
            annotation: { ...(mutation.annotation as object), serverRevision: 1 }
          }
        ],
        conflicts: []
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: pathName, details: {} }, meta: { requestId: 'req_mock' } })
    });
  });
}

async function json(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: { requestId: 'req_mock' } })
  });
}

function trackBrowserErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      if (message.text().includes('503 (Service Unavailable)')) {
        return;
      }
      consoleErrors.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  return { consoleErrors, pageErrors };
}
