import { expect, test, type Page } from '@playwright/test';

test('lists bundled sample scores on the library page', async ({ page }) => {
  const { consoleErrors, pageErrors } = trackBrowserErrors(page);

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
  await expect(page.getByTestId('annotation-overlay-ready')).toBeVisible();
  await expect(page.getByTestId('score-renderer')).toBeVisible();
  await expect(page.locator('[data-testid="score-renderer"] .score-page')).toHaveCount(1);
  await expect(page.locator('[data-testid="score-renderer"] .score-page__surface > svg')).toHaveCount(1);
  await expect(page.getByTestId('current-measure-id')).toHaveText(/simple-duet:p1:m1:/);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('selects measures, moves between them, and restores the current measure after reload', async ({ page }) => {
  const { consoleErrors, pageErrors } = trackBrowserErrors(page);

  await page.goto('/scores/lyrics-and-chords');
  await expect(page.getByTestId('score-viewer-ready')).toBeVisible();
  await expect(page.getByTestId('annotation-overlay-ready')).toBeVisible();
  await expect(page.locator('[data-testid="score-renderer"] .score-page__surface > svg')).toHaveCount(1);
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
  await expect(page.locator(`[data-testid="score-renderer"] .score-page__surface > svg [data-measure-id="${firstMeasureId}"]`)).toHaveClass(
    /is-selected/
  );

  await page.getByTestId('next-measure').click();
  const secondMeasureId = await page.getByTestId('current-measure-id').textContent();
  expect(secondMeasureId).toBeTruthy();
  expect(secondMeasureId).not.toBe(firstMeasureId);
  await expect(page.locator(`[data-testid="score-renderer"] .score-page__surface > svg [data-measure-id="${secondMeasureId}"]`)).toHaveClass(
    /is-selected/
  );
  await expect.poll(async () =>
    page.evaluate(() => (window as Window & { __scrollCalls?: Array<ScrollIntoViewOptions | boolean> }).__scrollCalls?.length ?? 0)
  ).toBeGreaterThan(0);

  await page.getByTestId('previous-measure').click();
  await expect(page.getByTestId('current-measure-id')).toHaveText(firstMeasureId ?? '');
  await expect(page.locator(`[data-testid="score-renderer"] .score-page__surface > svg [data-measure-id="${firstMeasureId}"]`)).toHaveClass(
    /is-selected/
  );

  await page.getByTestId('next-measure').click();
  await expect(page.getByTestId('current-measure-id')).toHaveText(secondMeasureId ?? '');
  await page.getByRole('button', { name: '+' }).click();
  await expect(page.getByTestId('viewer-zoom')).toHaveText('1.1x');
  await page.waitForFunction(
    async ({ scoreId, currentMeasureId, zoom }) => {
      const openDatabase = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('cuenote', 5);
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
  await expect(page.getByTestId('annotation-overlay-ready')).toBeVisible();
  await expect(page.getByTestId('current-measure-id')).toHaveText(secondMeasureId ?? '', { timeout: 15000 });
  await expect(page.locator(`[data-testid="score-renderer"] .score-page__surface > svg [data-measure-id="${secondMeasureId}"]`)).toHaveClass(
    /is-selected/
  );
  await expect(page.getByTestId('viewer-zoom')).toHaveText('1.1x');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('plays repeated navigation in occurrence order and restores paused playback after reload', async ({ page }) => {
  await installManualClock(page);
  const { consoleErrors, pageErrors } = trackBrowserErrors(page);

  await page.goto('/scores/ds-al-coda');
  await expect(page.getByTestId('score-viewer-ready')).toBeVisible();
  await expect(page.getByTestId('annotation-overlay-ready')).toBeVisible();
  await expect(page.locator('[data-testid="score-renderer"] .score-page__surface > svg')).toHaveCount(1);
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
  await expect(measureButtons).toHaveCount(5);
  await measureButtons.nth(2).click();
  await expect(page.getByTestId('current-measure-id')).toHaveText(/ds-al-coda:p1:m3:/);
  await expect(page.getByTestId('current-performance-measure-id')).toHaveText(/::1$/);
  await expect(
    page.locator('[data-testid="score-renderer"] .score-page__surface > svg [data-measure-id*="ds-al-coda:p1:m3:"]')
  ).toHaveClass(/is-selected/);

  await page.getByTestId('playback-bpm').fill('60');
  await expect(page.getByTestId('playback-bpm')).toHaveValue('60');
  await page.getByRole('button', { name: '+' }).click();
  await expect(page.getByTestId('viewer-zoom')).toHaveText('1.1x');

  await page.getByTestId('playback-play').click();
  await expect(page.getByTestId('playback-status')).toHaveText('COUNT_IN');

  await advanceClock(page, 2000);
  await expect(page.getByTestId('playback-status')).toHaveText('COUNT_IN');
  await expect(page.getByTestId('playback-current-beat')).toHaveText('3');

  await advanceClock(page, 2000);
  await expect(page.getByTestId('playback-status')).toHaveText('PLAYING');
  await expect(page.getByTestId('current-performance-measure-id')).toHaveText(/m3:ds-m3::1$/);

  await page.getByTestId('next-performance-measure').click();
  await expect(page.getByTestId('current-performance-measure-id')).toHaveText(/m4:ds-m4::1$/);

  await page.getByTestId('previous-performance-measure').click();
  await expect(page.getByTestId('current-performance-measure-id')).toHaveText(/m3:ds-m3::1$/);

  await advanceClock(page, 4000);
  await expect(page.getByTestId('current-performance-measure-id')).toHaveText(/m4:ds-m4::1$/);

  await advanceClock(page, 4000);
  await expect(page.getByTestId('current-performance-measure-id')).toHaveText(/m1:ds-m1::2$/);
  await expect(page.getByTestId('current-occurrence')).toHaveText('2');
  await expect(
    page.locator('[data-testid="score-renderer"] .score-page__surface > svg [data-measure-id*="ds-al-coda:p1:m1:"]')
  ).toHaveClass(/is-selected/);
  await expect.poll(async () =>
    page.evaluate(() => (window as Window & { __scrollCalls?: Array<ScrollIntoViewOptions | boolean> }).__scrollCalls?.length ?? 0)
  ).toBeGreaterThan(0);

  await advanceClock(page, 8000);
  await expect(page.getByTestId('current-performance-measure-id')).toHaveText(/m3:ds-m3::2$/);

  await advanceClock(page, 4000);
  await expect(page.getByTestId('current-performance-measure-id')).toHaveText(/m5:ds-m5::1$/);

  await page.getByTestId('playback-pause').click();
  await expect(page.getByTestId('playback-status')).toHaveText('PAUSED');

  await page.reload();
  await expect(page.getByTestId('score-viewer-ready')).toBeVisible();
  await expect(page.getByTestId('annotation-overlay-ready')).toBeVisible();
  await expect(page.getByTestId('playback-status')).toHaveText('PAUSED');
  await expect(page.getByTestId('current-performance-measure-id')).toHaveText(/m5:ds-m5::1$/);
  await expect(page.getByTestId('current-measure-id')).toHaveText(/ds-al-coda:p1:m5:/);
  await expect(page.getByTestId('viewer-zoom')).toHaveText('1.1x');
  await expect(page.getByTestId('playback-bpm')).toHaveValue('60');
  await expect(
    page.locator('[data-testid="score-renderer"] .score-page__surface > svg [data-measure-id*="ds-al-coda:p1:m5:"]')
  ).toHaveClass(/is-selected/);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('shows navigation warnings without breaking score rendering', async ({ page }) => {
  const { consoleErrors, pageErrors } = trackBrowserErrors(page);

  await page.goto('/scores/invalid-navigation');
  await expect(page.getByTestId('score-viewer-ready')).toBeVisible();
  await expect(page.getByTestId('annotation-overlay-ready')).toBeVisible();
  await expect(page.locator('[data-testid="score-renderer"] .score-page__surface > svg')).toHaveCount(1);
  await expect(page.getByTestId('playback-warning-count')).toHaveText('2');
  await expect(page.getByTestId('playback-warning-list')).toContainText('MISSING_SEGNO');
  await expect(page.getByTestId('playback-warning-list')).toContainText('MISSING_REPEAT_START');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('creates, persists, hides, and erases real canvas annotations with text notes', async ({ page }) => {
  const { consoleErrors, pageErrors } = trackBrowserErrors(page);

  await page.goto('/scores/lyrics-and-chords');
  await expect(page.getByTestId('score-viewer-ready')).toBeVisible();
  await expect(page.getByTestId('annotation-overlay-ready')).toBeVisible();

  await page.getByRole('button', { name: 'Annotate mode' }).click();
  await page.getByLabel('Tool').selectOption('PEN');
  await page.getByLabel('Scope').selectOption('PRIVATE');

  const measureLocator = page.locator('[data-testid="score-renderer"] .score-page__surface svg [data-measure-id*="lyrics-and-chords:p1:m1:"]').first();
  await measureLocator.scrollIntoViewIfNeeded();
  const measureBox = await measureLocator.boundingBox();
  expect(measureBox).toBeTruthy();

  await page.mouse.move(measureBox!.x + 20, measureBox!.y + 20);
  await page.mouse.down();
  await page.mouse.move(measureBox!.x + measureBox!.width - 20, measureBox!.y + measureBox!.height - 20, { steps: 10 });
  await page.mouse.up();

  await expect(page.getByTestId('annotation-save-status')).toContainText(/saved/i);
  await expect.poll(() => countNonTransparentPixels(page)).toBeGreaterThan(0);
  await expect.poll(() => getAnnotationStoreCount(page, 'lyrics-and-chords', 'lyrics-and-chords:version-1')).toBe(1);

  await page.getByLabel('Tool').selectOption('TEXT');
  await page.mouse.click(measureBox!.x + 40, measureBox!.y + 30);
  await expect(page.getByTestId('annotation-text-editor')).toBeVisible();
  await page.getByTestId('annotation-text-editor').locator('textarea').fill('Cue change');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.annotation-text-note')).toContainText('Cue change');
  await expect.poll(() => getAnnotationStoreCount(page, 'lyrics-and-chords', 'lyrics-and-chords:version-1')).toBe(2);

  await page.locator('label').filter({ hasText: 'Private' }).locator('input').uncheck();
  await expect(page.locator('.annotation-text-note')).toHaveCount(0);
  const beforeHiddenEraseCount = await getAnnotationStoreCount(page, 'lyrics-and-chords', 'lyrics-and-chords:version-1');

  await page.getByLabel('Tool').selectOption('ERASER');
  await page.mouse.click(measureBox!.x + 50, measureBox!.y + 40);
  await expect.poll(() => getAnnotationStoreCount(page, 'lyrics-and-chords', 'lyrics-and-chords:version-1')).toBe(beforeHiddenEraseCount);

  await page.locator('label').filter({ hasText: 'Private' }).locator('input').check();
  await expect(page.locator('.annotation-text-note')).toContainText('Cue change');

  await page.getByLabel('Tool').selectOption('TEXT');
  await page.locator('.annotation-text-note').click();
  await expect(page.getByTestId('annotation-text-editor')).toBeVisible();
  await page.getByTestId('annotation-text-editor').locator('textarea').fill('Cue update');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.annotation-text-note')).toContainText('Cue update');

  await page.getByLabel('Tool').selectOption('ERASER');
  const textNoteBox = await page.locator('.annotation-text-note').boundingBox();
  expect(textNoteBox).toBeTruthy();
  await page.mouse.click(textNoteBox!.x + textNoteBox!.width / 2, textNoteBox!.y + textNoteBox!.height / 2);
  await expect.poll(() => getAnnotationStoreCount(page, 'lyrics-and-chords', 'lyrics-and-chords:version-1')).toBe(1);
  await measureLocator.scrollIntoViewIfNeeded();
  const strokeEraseBox = await measureLocator.boundingBox();
  expect(strokeEraseBox).toBeTruthy();
  await page.mouse.click(strokeEraseBox!.x + 24, strokeEraseBox!.y + 24);
  await expect.poll(() => getAnnotationStoreCount(page, 'lyrics-and-chords', 'lyrics-and-chords:version-1')).toBe(0);

  await page.reload();
  await expect(page.getByTestId('score-viewer-ready')).toBeVisible();
  await expect(page.getByTestId('annotation-overlay-ready')).toBeVisible();
  await expect(page.getByTestId('viewer-zoom')).toHaveText('1.0x');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('keeps existing annotations visible during playback and blocks new input until paused', async ({ page }) => {
  await installManualClock(page);
  const { consoleErrors, pageErrors } = trackBrowserErrors(page);

  await page.goto('/scores/ds-al-coda');
  await expect(page.getByTestId('score-viewer-ready')).toBeVisible();
  await expect(page.getByTestId('annotation-overlay-ready')).toBeVisible();
  await page.getByRole('button', { name: 'Annotate mode' }).click();
  await page.getByLabel('Tool').selectOption('PEN');

  const measureLocator = page.locator('[data-testid="score-renderer"] .score-page__surface svg [data-measure-id*="ds-al-coda:p1:m3:"]').first();
  await measureLocator.scrollIntoViewIfNeeded();
  const measureBox = await measureLocator.boundingBox();
  expect(measureBox).toBeTruthy();

  await page.mouse.move(measureBox!.x + 24, measureBox!.y + 24);
  await page.mouse.down();
  await page.mouse.move(measureBox!.x + measureBox!.width - 24, measureBox!.y + 24, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => getAnnotationStoreCount(page, 'ds-al-coda', 'ds-al-coda:version-1')).toBe(1);
  await expect.poll(() => countNonTransparentPixels(page)).toBeGreaterThan(0);

  await page.getByTestId('playback-bpm').fill('60');
  await page.getByTestId('playback-play').click();
  await expect(page.getByTestId('playback-status')).toHaveText('COUNT_IN');
  await expect(page.getByText('Pause or stop playback before creating or editing annotations.')).toBeVisible();

  await page.mouse.move(measureBox!.x + 30, measureBox!.y + 30);
  await page.mouse.down();
  await page.mouse.move(measureBox!.x + 80, measureBox!.y + 30, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => getAnnotationStoreCount(page, 'ds-al-coda', 'ds-al-coda:version-1')).toBe(1);

  await advanceClock(page, 4000);
  await expect(page.getByTestId('playback-status')).toHaveText('PLAYING');

  await page.getByTestId('playback-pause').click();
  await expect(page.getByTestId('playback-status')).toHaveText('PAUSED');
  await measureLocator.scrollIntoViewIfNeeded();
  const pausedMeasureBox = await measureLocator.boundingBox();
  expect(pausedMeasureBox).toBeTruthy();

  await page.mouse.move(pausedMeasureBox!.x + 30, pausedMeasureBox!.y + 50);
  await page.mouse.down();
  await page.mouse.move(pausedMeasureBox!.x + 90, pausedMeasureBox!.y + 50, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => getAnnotationStoreCount(page, 'ds-al-coda', 'ds-al-coda:version-1')).toBe(2);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

function trackBrowserErrors(page: Page) {
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

  return { consoleErrors, pageErrors };
}

async function installManualClock(page: Page) {
  await page.addInitScript(() => {
    let currentMs = 0;
    const listeners = new Set<() => void>();

    (window as Window & { __CUENOTE_PLAYBACK_CLOCK__?: unknown; __advanceCueNoteClock?: (deltaMs: number) => void }).__CUENOTE_PLAYBACK_CLOCK__ = {
      now: () => currentMs,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    };

    (window as Window & { __advanceCueNoteClock?: (deltaMs: number) => void }).__advanceCueNoteClock = (deltaMs: number) => {
      currentMs += deltaMs;
      listeners.forEach((listener) => listener());
    };
  });
}

async function advanceClock(page: Page, deltaMs: number) {
  await page.evaluate((step) => {
    (window as Window & { __advanceCueNoteClock?: (deltaMs: number) => void }).__advanceCueNoteClock?.(step);
  }, deltaMs);
}

async function countNonTransparentPixels(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="annotation-canvas"]') as HTMLCanvasElement | null;
    if (!canvas) {
      return 0;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return 0;
    }

    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    const stepX = Math.max(1, Math.floor(width / 64));
    const stepY = Math.max(1, Math.floor(height / 64));

    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const index = (y * width + x) * 4 + 3;
        if (data[index] > 0) {
          count += 1;
        }
      }
    }

    return count;
  });
}

async function getAnnotationStoreCount(page: Page, scoreId: string, scoreVersionId: string) {
  return page.evaluate(
    async ({ scoreId, scoreVersionId }) => {
      const request = indexedDB.open('cuenote', 5);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      });

      try {
        const records = await new Promise<any[]>((resolve, reject) => {
          const transaction = database.transaction('annotations', 'readonly');
          const store = transaction.objectStore('annotations');
          const getAllRequest = store.getAll();
          getAllRequest.onsuccess = () => resolve(getAllRequest.result as any[]);
          getAllRequest.onerror = () => reject(getAllRequest.error ?? new Error('IndexedDB getAll failed'));
        });

        return records.filter((record) => record?.scoreId === scoreId && record?.scoreVersionId === scoreVersionId).length;
      } finally {
        database.close();
      }
    },
    { scoreId, scoreVersionId }
  );
}
