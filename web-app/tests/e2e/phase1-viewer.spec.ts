import { expect, test } from '@playwright/test';

test('lists bundled sample scores on the library page', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto('/');
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) {
      return false;
    }

    const registrations = await navigator.serviceWorker.getRegistrations();
    return registrations.length > 0;
  });

  await expect(page.getByRole('link', { name: 'CueNote' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Simple Duet' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lyrics and Chords' })).toBeVisible();

  const simpleCard = page.locator('.score-card').filter({ hasText: 'Simple Duet' });
  await simpleCard.getByRole('link').click();

  await page.waitForURL('**/scores/simple-duet');
  await expect(page.getByTestId('score-viewer-ready')).toBeVisible();
  await expect(page.getByTestId('score-renderer')).toBeVisible();
  await expect(page.locator('[data-testid="score-renderer"] .score-page')).toHaveCount(1);
  await expect(page.locator('[data-testid="score-renderer"] .score-page > svg')).toHaveCount(1);
  await expect(page.getByTestId('current-measure-id')).toHaveText(/simple-duet:p1:m1:/);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('selects measures, moves between them, and restores the current measure after reload', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto('/scores/lyrics-and-chords');

  await page.waitForURL('**/scores/lyrics-and-chords');
  await expect(page.getByTestId('score-viewer-ready')).toBeVisible();
  await expect(page.getByTestId('score-renderer')).toBeVisible();
  await expect(page.locator('[data-testid="score-renderer"] .score-page')).toHaveCount(1);
  await expect(page.locator('[data-testid="score-renderer"] .score-page > svg')).toHaveCount(1);
  await expect(page.getByTestId('current-measure-id')).toHaveText(/lyrics-and-chords:p1:m1:/);
  await page.evaluate(() => {
    const win = window as Window & { __scrollCalls?: Array<ScrollIntoViewOptions | boolean> };
    win.__scrollCalls = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(options?: ScrollIntoViewOptions | boolean) {
      win.__scrollCalls?.push(options ?? true);
      return original.call(this, options as ScrollIntoViewOptions);
    };
  });

  const measureButtons = page.locator('.measure-item');
  await expect(measureButtons).toHaveCount(2);

  await measureButtons.nth(0).click();
  const firstMeasureId = await page.getByTestId('current-measure-id').textContent();
  expect(firstMeasureId).toBeTruthy();
  await expect(page.locator(`[data-testid="score-renderer"] [data-measure-id="${firstMeasureId}"]`)).toHaveClass(/is-selected/);

  await page.getByTestId('next-measure').click();
  const secondMeasureId = await page.getByTestId('current-measure-id').textContent();
  expect(secondMeasureId).toBeTruthy();
  expect(secondMeasureId).not.toBe(firstMeasureId);
  await expect(page.locator(`[data-testid="score-renderer"] [data-measure-id="${secondMeasureId}"]`)).toHaveClass(/is-selected/);
  await expect.poll(async () =>
    page.evaluate(() => (window as Window & { __scrollCalls?: Array<ScrollIntoViewOptions | boolean> }).__scrollCalls?.length ?? 0)
  ).toBeGreaterThan(0);

  await page.getByTestId('previous-measure').click();
  await expect(page.getByTestId('current-measure-id')).toHaveText(firstMeasureId ?? '');
  await expect(page.locator(`[data-testid="score-renderer"] [data-measure-id="${firstMeasureId}"]`)).toHaveClass(/is-selected/);

  await page.getByTestId('next-measure').click();
  await expect(page.getByTestId('current-measure-id')).toHaveText(secondMeasureId ?? '');
  await page.getByRole('button', { name: '+' }).click();
  await expect(page.getByTestId('viewer-zoom')).toHaveText('1.1x');
  await page.waitForFunction(
    async ({ scoreId, currentMeasureId, zoom }) => {
      const openDatabase = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('cuenote', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
        });

      const database = await openDatabase();

      try {
        const record = await new Promise<any>((resolve, reject) => {
          const transaction = database.transaction('recent_scores', 'readonly');
          const request = transaction.objectStore('recent_scores').get(scoreId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
        });

        return record?.currentMeasureId === currentMeasureId && record?.zoom === zoom;
      } finally {
        database.close();
      }
    },
    { scoreId: 'lyrics-and-chords', currentMeasureId: secondMeasureId, zoom: 1.1 }
  );

  await page.reload();

  await expect(page.getByTestId('score-viewer-ready')).toBeVisible();
  await expect(page.getByTestId('current-measure-id')).toHaveText(secondMeasureId ?? '', { timeout: 15000 });
  await expect(page.locator(`[data-testid="score-renderer"] [data-measure-id="${secondMeasureId}"]`)).toHaveClass(/is-selected/);
  await expect(page.getByTestId('viewer-zoom')).toHaveText('1.1x');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
