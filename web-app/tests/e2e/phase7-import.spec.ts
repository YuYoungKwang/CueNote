import { expect, test, type Page } from '@playwright/test';

test('imports a synthetic score image, reviews layout regions, and restores review preferences', async ({ page }) => {
  const { consoleErrors, pageErrors } = trackBrowserErrors(page);

  await page.goto('/');
  await page.getByTestId('imports-link').click();
  await expect(page.getByTestId('empty-import-library')).toBeVisible();
  await page.getByTestId('new-import-link').click();

  await page.getByTestId('import-file-input').setInputFiles({
    name: 'synthetic-staff.bmp',
    mimeType: 'image/bmp',
    buffer: createSyntheticStaffBmp()
  });
  await page.getByTestId('start-import').click();
  await page.waitForURL(/\/imports\/.+\/review/);
  const reviewUrl = page.url();

  await expect(page.getByTestId('import-review-status')).toContainText(/Review layout|Correction|ready/i);
  await expect(page.getByTestId('import-region-overlay')).toBeVisible();
  await expect(page.getByTestId('import-region-system').first()).toBeVisible();
  await expect(page.getByTestId('import-region-staff').first()).toBeVisible();
  await expect(page.getByTestId('import-region-measure').first()).toBeVisible();
  await expect(page.getByTestId('omr-preparation-manifest-summary')).toContainText(/pages/);

  const initialMeasureCount = await page.getByTestId('import-region-measure').count();
  await page.getByTestId('add-measure-region').click();
  await expect.poll(() => page.getByTestId('import-region-measure').count()).toBe(initialMeasureCount + 1);

  await page.getByTestId('import-region-measure').last().click();
  await page.getByTestId('split-region').click();
  await expect.poll(() => page.getByTestId('import-region-measure').count()).toBeGreaterThan(initialMeasureCount + 1);

  await page.getByTestId('merge-regions').click();
  await expect(page.getByTestId('import-review-status')).toContainText(/Correction|Review/i);

  await page.getByRole('button', { name: '+' }).click();
  await expect(page.getByTestId('import-zoom')).toHaveText('1.1x');
  await page.reload();
  await expect(page.getByTestId('import-zoom')).toHaveText('1.1x');

  await page.getByTestId('complete-import-review').click();
  await expect(page.getByTestId('import-review-status')).toContainText(/Review complete|ready for Phase 8/i);

  await page.goto('/imports');
  await expect(page.getByTestId('import-project-list')).toContainText('synthetic-staff');
  await page.goto(reviewUrl);
  await expect(page.getByTestId('import-region-overlay')).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('imports a generated PDF through the PDF.js adapter without server APIs', async ({ page }) => {
  const { consoleErrors, pageErrors } = trackBrowserErrors(page);

  await page.goto('/imports/new');
  await page.getByTestId('import-file-input').setInputFiles({
    name: 'synthetic-score.pdf',
    mimeType: 'application/pdf',
    buffer: createSimplePdf()
  });
  await page.getByTestId('start-import').click();
  await page.waitForURL(/\/imports\/.+\/review/);

  await expect(page.getByTestId('import-region-overlay')).toBeVisible();
  await expect(page.getByTestId('import-warning-list')).toBeVisible();
  await expect(page.getByTestId('omr-preparation-manifest-summary')).toContainText('1 pages');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

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

function createSimplePdf(): Buffer {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 190 >>\nstream\n0 0 0 RG\n1 w\n40 150 m 320 150 l S\n40 140 m 320 140 l S\n40 130 m 320 130 l S\n40 120 m 320 120 l S\n40 110 m 320 110 l S\n40 105 m 40 155 l S\n130 105 m 130 155 l S\n220 105 m 220 155 l S\n320 105 m 320 155 l S\nendstream\nendobj\n'
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, 'ascii'));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body, 'ascii');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let index = 1; index <= objects.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
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
