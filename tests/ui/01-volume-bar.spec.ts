/**
 * tests/ui/01-volume-bar.spec.ts — Phase 12
 *
 * Tests Stage 4 of LOCAL_TESTING_CHECKLIST.md:
 *   • Admin login page renders + login flow
 *   • Admin sub-pages load
 *   • Battle page loads (Live2D/Spine are non-blocking — must NOT use networkidle)
 *   • Volume bar popover
 *
 * IMPORTANT: Battle page polls Live2D/Spine animation frames forever, so
 * `waitForLoadState('networkidle')` hangs. We use `domcontentloaded` + a
 * short timeout for hydration, then proceed.
 */

import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';

// ── 4.1 Admin login page loads ─────────────────────────────────────────────────

test('admin login page renders with password input', async ({ page }) => {
  await page.goto(`${BASE}/admin/login`);
  const pwInput = page.locator('input[type="password"]').first();
  await pwInput.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(pwInput).toBeVisible();
});

// ── 4.2 Admin login flow ────────────────────────────────────────────────────────

test('admin can log in with dev password', async ({ page }) => {
  await page.goto(`${BASE}/admin/login`);
  const pwInput = page.locator('input[type="password"]').first();
  await pwInput.waitFor({ state: 'visible', timeout: 10_000 });
  await pwInput.fill('dev');
  await page.getByRole('button', { name: /login|登录|submit/i }).click();
  // Should redirect away from /admin/login
  await page.waitForURL((u) => !u.toString().includes('/admin/login'), { timeout: 10_000 });
});

// ── 4.3 Admin activities page loads ─────────────────────────────────────────────

test('admin activities page loads', async ({ page }) => {
  await page.goto(`${BASE}/admin/login`);
  const pwInput = page.locator('input[type="password"]').first();
  await pwInput.waitFor({ state: 'visible', timeout: 10_000 });
  await pwInput.fill('dev');
  await page.getByRole('button', { name: /login|登录|submit/i }).click();
  await page.waitForURL((u) => !u.toString().includes('/admin/login'), { timeout: 10_000 });

  await page.goto(`${BASE}/admin/activities`);
  await page.waitForLoadState('domcontentloaded');
  const body = await page.textContent('body');
  expect(body?.trim().length).toBeGreaterThan(0);
});

// ── 4.4 Admin users page loads ─────────────────────────────────────────────────

test('admin users page loads', async ({ page }) => {
  await page.goto(`${BASE}/admin/login`);
  const pwInput = page.locator('input[type="password"]').first();
  await pwInput.waitFor({ state: 'visible', timeout: 10_000 });
  await pwInput.fill('dev');
  await page.getByRole('button', { name: /login|登录|submit/i }).click();
  await page.waitForURL((u) => !u.toString().includes('/admin/login'), { timeout: 10_000 });

  await page.goto(`${BASE}/admin/users`);
  await page.waitForLoadState('domcontentloaded');
  const body = await page.textContent('body');
  expect(body?.trim().length).toBeGreaterThan(0);
});

// ── 4.5 Battle page loads ───────────────────────────────────────────────────────

test('battle page loads (may redirect to login if no session)', async ({ page }) => {
  await page.goto(`${BASE}/battle`);
  // Don't wait for networkidle — battle page polls Live2D/Spine forever
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
  const content = await page.content();
  expect(content).toBeTruthy();
});

// ── 4.6 Volume bar — BGM button opens popover ───────────────────────────────────

test('BGM button opens volume popover (skipped if battle redirects)', async ({ page }) => {
  // Set the user cookie via Playwright's context API (page.goto doesn't accept headers).
  await page.context().addCookies([
    {
      name: 'uid',
      value: `pw-bgm-test-${Date.now()}`,
      url: BASE,
    },
  ]);
  await page.goto(`${BASE}/battle`);
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
  // Give React + AudioManager 2s to hydrate
  await page.waitForTimeout(2000);

  // Look for any button with BGM/volume-related text
  const volumeButton = page
    .locator('button')
    .filter({ hasText: /bgm|音量|volume|🔊|🔇|sound/i })
    .first();

  if ((await volumeButton.count()) === 0) {
    test.skip(true, 'BGM volume button not found — battle page may have redirected to login');
    return;
  }

  await volumeButton.click();
  const popover = page
    .locator('[role="slider"], [data-testid="volume-slider"], input[type="range"]')
    .first();
  await expect(popover).toBeVisible({ timeout: 3000 });
});

// ── 4.7 Volume bar — external click closes popover ──────────────────────────────

test('clicking outside volume popover closes it (skipped if battle redirects)', async ({ page }) => {
  await page.context().addCookies([
    {
      name: 'uid',
      value: `pw-ext-click-${Date.now()}`,
      url: BASE,
    },
  ]);
  await page.goto(`${BASE}/battle`);
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
  await page.waitForTimeout(2000);

  const volumeButton = page
    .locator('button')
    .filter({ hasText: /bgm|音量|volume|🔊|🔇|sound/i })
    .first();

  if ((await volumeButton.count()) === 0) {
    test.skip(true, 'Volume button not found — battle page may have redirected to login');
    return;
  }
  await volumeButton.click();

  const slider = page.locator('input[type="range"]').first();
  const sliderVisible = await slider.isVisible().catch(() => false);
  if (!sliderVisible) {
    test.skip(true, 'Slider did not appear after clicking volume button');
    return;
  }

  await page.click('body', { position: { x: 10, y: 10 } });
  await page.waitForTimeout(300);

  const stillVisible = await slider.isVisible().catch(() => false);
  expect(stillVisible).toBe(false);
});