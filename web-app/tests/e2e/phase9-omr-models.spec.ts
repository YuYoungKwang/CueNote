import { expect, test, type Page } from '@playwright/test';

test('runs Phase 9 experimental layout and symbol ONNX models in the browser runtime', async ({ page }) => {
  const { consoleErrors, pageErrors } = trackBrowserErrors(page);

  await createReviewedImportProject(page);
  await page.getByTestId('open-omr-runtime').click();
  await expect(page.getByTestId('omr-runtime-page')).toBeVisible();

  await runModel(page, 'LAYOUT_SMOKE_MODEL', /cuenote-layout-smoke/, /measure\.region|system\.region/);
  await expect(page.getByTestId('omr-product-state')).toHaveText('PRODUCT_MODEL_NOT_INSTALLED');
  await expect(page.getByTestId('omr-model-status')).toHaveText('EXPERIMENTAL');

  await page.context().setOffline(true);
  await page.getByTestId('omr-load-model').click();
  await expect.poll(async () => page.getByTestId('omr-cache-state').textContent(), { timeout: 30000 }).toBe('hit');
  await page.context().setOffline(false);

  await runModel(page, 'SYMBOL_SMOKE_MODEL', /cuenote-symbol-smoke/, /notehead\.filled|clef\.treble/);
  await expect(page.getByTestId('omr-product-state')).toHaveText('PRODUCT_MODEL_NOT_INSTALLED');
  await expect(page.getByTestId('omr-detection-box').first()).toBeVisible();

  await page.getByRole('link', { name: 'Draft status' }).click();
  await expect(page.getByTestId('omr-draft-deferred')).toContainText('Phase 10');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('runs installed Colab experimental layout and symbol artifacts without promoting them', async ({ page }) => {
  const { consoleErrors, pageErrors } = trackBrowserErrors(page);

  await createReviewedImportProject(page);
  await page.getByTestId('open-omr-runtime').click();
  await expect(page.getByTestId('omr-runtime-page')).toBeVisible();
  await page.getByTestId('omr-fixture-synthetic-basic-staff').click();
  await expect(page.getByTestId('omr-fixture-metadata')).toContainText('Synthetic staff and symbols');

  await runInstalledExperimentalModel(page, 'cuenote-layout-deepscores-exp');
  await page.context().setOffline(true);
  await page.getByTestId('omr-load-model').click();
  await expect.poll(async () => page.getByTestId('omr-cache-state').textContent(), { timeout: 30000 }).toBe('hit');
  await page.context().setOffline(false);

  await runInstalledExperimentalModel(page, 'cuenote-symbol-deepscores-exp', 'cuenote-symbol-deepscores-exp');
  await runInstalledExperimentalModel(page, 'cuenote-symbol-deepscores-exp-0.1.0-colab-tile', 'cuenote-symbol-deepscores-exp', true);
  await expect(page.getByTestId('omr-summary-detection-count')).not.toHaveText('0');
  await expect(page.getByTestId('omr-summary-class-counts')).not.toHaveText('No class counts');
  await exerciseOmrReviewUi(page);
  await page.getByTestId('omr-model-select').selectOption('cuenote-symbol-deepscores-exp-0.1.0-colab-tile');
  await page.getByTestId('omr-load-model').click();
  await expect.poll(async () => page.getByTestId('omr-provider').textContent(), { timeout: 30000 }).toMatch(/WEBGPU|WASM/);
  await page.context().setOffline(true);
  await page.getByTestId('omr-load-model').click();
  await expect.poll(async () => page.getByTestId('omr-cache-state').textContent(), { timeout: 30000 }).toBe('hit');
  await page.context().setOffline(false);

  await page.getByRole('link', { name: 'Draft status' }).click();
  await expect(page.getByTestId('omr-draft-deferred')).toContainText('Phase 10');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

async function runModel(page: Page, modelId: string, resultPattern: RegExp, detectionPattern: RegExp) {
  await page.getByTestId('omr-model-select').selectOption(modelId);
  await expect(page.getByTestId('omr-model-kind')).toHaveText(modelId);
  await page.getByTestId('omr-load-model').click();
  await expect.poll(async () => page.getByTestId('omr-provider').textContent(), { timeout: 30000 }).toMatch(/WEBGPU|WASM/);
  await page.getByTestId('omr-run-system').click();
  await expect(page.getByTestId('omr-runtime-result')).toContainText(/detections: [1-9]/, { timeout: 30000 });
  await expect(page.getByTestId('omr-result-list')).toContainText(resultPattern);
  await expect(page.getByTestId('omr-detection-list')).toContainText(detectionPattern);
}

async function exerciseOmrReviewUi(page: Page) {
  const detectionBoxes = page.getByTestId('omr-detection-box');
  const initialBoxCount = await detectionBoxes.count();
  expect(initialBoxCount).toBeGreaterThan(0);

  await page.getByTestId('omr-confidence-threshold').evaluate((input) => {
    const element = input as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, '1');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByTestId('omr-detection-list')).toContainText('No visible detections');
  await page.getByTestId('omr-confidence-threshold').evaluate((input) => {
    const element = input as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, '0');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(detectionBoxes.first()).toBeVisible();

  const firstClass = ((await page.getByTestId('omr-detection-list-item').first().locator('.measure-item__number').textContent()) ?? '').trim();
  await page.getByTestId(`omr-class-toggle-${firstClass.replace(/[^a-zA-Z0-9_-]+/g, '-')}`).click();
  await expect.poll(async () => page.getByTestId('omr-detection-box').count()).toBeLessThan(initialBoxCount);
  await page.getByTestId(`omr-class-toggle-${firstClass.replace(/[^a-zA-Z0-9_-]+/g, '-')}`).click();

  await page.getByTestId('omr-detection-list-item').first().click();
  await expect(page.getByTestId('omr-selected-detection')).not.toHaveText('No detection selected');
  await page.getByTestId('omr-symbol-class-select').selectOption({ index: 0 });
  await page.getByTestId('omr-change-class').click();
  await expect(page.getByTestId('omr-correction-count')).toContainText(/1 corrections saved|2 corrections saved/);
  await page.getByTestId('omr-delete-detection').click();
  await expect(page.getByTestId('omr-correction-count')).toContainText(/2 corrections saved|3 corrections saved/);

  await page.getByTestId('omr-add-detection-mode').click();
  await page.locator('.import-region--system').click();
  await expect(page.getByTestId('omr-correction-count')).toContainText(/3 corrections saved|4 corrections saved/);

  await page.getByTestId('omr-export-review-json').click();
  await expect(page.getByTestId('omr-review-json')).toContainText('CUENOTE_OMR_REVIEW');
  await expect(page.getByTestId('omr-review-json')).toContainText('corrections');
  await page.getByTestId('omr-import-review-json').click();
  await expect(page.getByTestId('omr-runtime-status')).toContainText('Review JSON imported');

  await page.getByTestId('omr-evaluation-reviewer-note').fill('Manual fixture review: detection overlay needs notehead follow-up.');
  await page.getByTestId('omr-known-failure-missed-notehead').check();
  await page.getByTestId('omr-known-failure-crop-stitch-duplicate').check();
  await page.getByTestId('omr-save-evaluation-report').click();
  await expect(page.getByTestId('omr-runtime-status')).toContainText('Manual evaluation report saved');
  await expect(page.getByTestId('omr-evaluation-report-count')).toHaveText('1');
  await page.getByTestId('omr-export-evaluation-report').click();
  await expect(page.getByTestId('omr-evaluation-report-json')).toContainText('CUENOTE_OMR_MANUAL_EVALUATION');
  await expect(page.getByTestId('omr-evaluation-report-json')).toContainText('missed-notehead');
  await expect(page.getByTestId('omr-evaluation-report-json')).toContainText('detectionCount');
  await page.getByTestId('omr-import-evaluation-report').click();
  await expect(page.getByTestId('omr-runtime-status')).toContainText('Manual evaluation report JSON imported');
  await expect(page.getByTestId('omr-evaluation-report-count')).toHaveText('1');

  await page.reload();
  await expect(page.getByTestId('omr-runtime-page')).toBeVisible();
  await page.getByTestId('omr-fixture-synthetic-basic-staff').click();
  await expect(page.getByTestId('omr-evaluation-report-count')).toHaveText('1');
  await expect(page.getByTestId('omr-evaluation-reviewer-note')).toHaveValue(/Manual fixture review/);
  await expect(page.getByTestId('omr-known-failure-missed-notehead')).toBeChecked();
  await expect(page.getByTestId('omr-correction-count')).toContainText(/corrections saved/);
  await expect(page.getByTestId('omr-review-json')).toBeVisible();
}

async function runInstalledExperimentalModel(page: Page, catalogId: string, resultModelId = catalogId, requireOverlay = false) {
  await expect(page.getByTestId('omr-model-select').locator(`option[value="${catalogId}"]`)).toHaveCount(1);
  await page.getByTestId('omr-model-select').selectOption(catalogId);
  await expect(page.getByTestId('omr-model-kind')).toHaveText(catalogId);
  await page.getByTestId('omr-load-model').click();
  await expect.poll(async () => page.getByTestId('omr-provider').textContent(), { timeout: 30000 }).toMatch(/WEBGPU|WASM/);
  await expect(page.getByTestId('omr-model-status')).toHaveText('EXPERIMENTAL');
  await expect(page.getByTestId('omr-product-state')).toHaveText('PRODUCT_MODEL_NOT_INSTALLED');
  await page.getByTestId('omr-run-system').click();
  await expect(page.getByTestId('omr-runtime-result')).toContainText(/detections: \d+/, { timeout: 60000 });
  await expect(page.getByTestId('omr-result-list')).toContainText(resultModelId);
  if (requireOverlay) {
    await expect(page.getByTestId('omr-detection-box').first()).toBeVisible();
  }
  await expect(page.getByTestId('omr-draft-deferred')).not.toBeVisible();
}

async function createReviewedImportProject(page: Page) {
  await page.goto('/imports/new');
  await page.getByTestId('import-file-input').setInputFiles({
    name: 'phase9-system.bmp',
    mimeType: 'image/bmp',
    buffer: createSyntheticStaffBmp()
  });
  await page.getByTestId('start-import').click();
  await page.waitForURL(/\/imports\/.+\/review/);
  await expect(page.getByTestId('import-region-system').first()).toBeVisible();
  await page.getByTestId('complete-import-review').click();
  await expect(page.getByTestId('import-review-status')).toContainText(/Review complete|ready for Phase 8/i);
}

function createSyntheticStaffBmp(): Buffer {
  const width = 360;
  const height = 240;
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;
  const buffer = Buffer.alloc(fileSize, 255);

  buffer.write('BM', 0, 'ascii');
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(0, 30);
  buffer.writeUInt32LE(pixelArraySize, 34);

  const setPixel = (x: number, yFromTop: number, r: number, g: number, b: number) => {
    const y = height - 1 - yFromTop;
    const offset = 54 + y * rowSize + x * 3;
    buffer[offset] = b;
    buffer[offset + 1] = g;
    buffer[offset + 2] = r;
  };

  for (const y of [82, 92, 102, 112, 122]) {
    for (let x = 40; x < 320; x += 1) {
      setPixel(x, y, 0, 0, 0);
    }
  }
  for (const x of [40, 130, 220, 320]) {
    for (let y = 76; y < 128; y += 1) {
      setPixel(x, y, 0, 0, 0);
    }
  }

  return buffer;
}

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
