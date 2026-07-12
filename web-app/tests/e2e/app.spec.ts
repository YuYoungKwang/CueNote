import { expect, test } from '@playwright/test';

test('renders the phase 0 shell and registers the PWA shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'CueNote' })).toBeVisible();
  await expect(page.getByText('Phase 0', { exact: true })).toBeVisible();

  await page.waitForTimeout(1000);
  const registrationCount = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) {
      return 0;
    }

    const registrations = await navigator.serviceWorker.getRegistrations();
    return registrations.length;
  });

  expect(registrationCount).toBeGreaterThanOrEqual(1);
});
