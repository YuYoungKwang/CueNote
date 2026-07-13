import { expect, test, type Page } from '@playwright/test';

test.describe('Phase 6 real backend score editing', () => {
  test.skip(process.env.CUENOTE_REAL_PHASE6_E2E !== '1', 'Set CUENOTE_REAL_PHASE6_E2E=1 when the real backend is running.');

  test('publishes an edited MusicXML score version through the real backend', async ({ page }) => {
    const { consoleErrors, pageErrors } = trackBrowserErrors(page);

    await page.goto('/');
    await page.getByTestId('dev-login').click();
    await expect(page.getByTestId('server-session-user')).toHaveText('phase4@cuenote.local');
    await page.getByTestId('server-ensemble-create').click();
    await expect(page.getByTestId('server-library-status')).toContainText(/ready|Ensemble/i);
    await page.getByTestId('publish-samples').click();
    await expect(page.getByTestId('server-score-list')).toContainText('Lyrics and Chords');
    await page.getByTestId('server-score-list').getByRole('link', { name: /Lyrics and Chords/ }).click();
    await page.waitForURL(/\/scores\/.+source=server&versionId=.+/);

    const viewerUrl = new URL(page.url());
    const scoreId = viewerUrl.pathname.split('/').pop()!;
    const baseVersionId = viewerUrl.searchParams.get('versionId')!;

    await page.getByTestId('open-score-editor').click();
    await page.waitForURL(new RegExp(`/scores/${scoreId}/edit.*versionId=${baseVersionId}`));
    await expect(page.getByTestId('score-edit-ready')).toBeVisible();
    await expect(page.locator('[data-testid="score-renderer"] .score-page__surface > svg')).toHaveCount(1);

    await page.getByTestId('score-edit-pitch-up').click();
    await page.getByTestId('score-edit-lyric').fill(`Phase 6 ${Date.now()}`);
    await page.getByTestId('score-edit-chord').fill('Dm7');
    await expect(page.getByTestId('score-edit-dirty')).toHaveText('yes');
    await expect(page.getByTestId('score-edit-validation-count')).toHaveText('0');

    await page.getByTestId('score-edit-publish').click();
    await page.waitForURL((url) => url.pathname === `/scores/${scoreId}` && url.searchParams.get('versionId') !== baseVersionId);
    const publishedUrl = new URL(page.url());
    expect(publishedUrl.searchParams.get('versionId')).not.toBe(baseVersionId);
    await expect(page.getByTestId('score-viewer-ready')).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

function trackBrowserErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (!text.includes('Failed to load resource')) {
        consoleErrors.push(text);
      }
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  return { consoleErrors, pageErrors };
}
