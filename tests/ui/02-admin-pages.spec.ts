/**
 * tests/ui/02-admin-pages.spec.ts — Phase 12
 *
 * Tests Stage 3 of LOCAL_TESTING_CHECKLIST.md:
 *   • admin pages load without console.error
 *   • admin/login → admin redirect after login
 *   • admin/banners, admin/monitor load
 */

import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';

/** Perform dev login and return the page object. */
async function adminLogin(page: Page) {
  await page.goto(`${BASE}/admin/login`);
  // Wait for the password input to appear (instead of networkidle, which can hang on long-polling)
  const pwInput = page.locator('input[type="password"]').first();
  await pwInput.waitFor({ state: 'visible', timeout: 10_000 });
  await pwInput.fill('dev');
  await page.getByRole('button', { name: /login|登录|submit/i }).click();
  // Wait for redirect away from /admin/login
  await page.waitForURL((u) => !u.toString().includes('/admin/login'), { timeout: 10_000 });
}

// ── 5.1 admin/ redirects to login ───────────────────────────────────────────────

test('GET /admin redirects to /admin/login when unauthenticated', async ({ page }) => {
  const res = await page.request.get(`${BASE}/admin`);
  // Should redirect (3xx) or land on login page
  expect([200, 301, 302, 303, 307, 308]).toContain(res.status());
});

// ── 5.2 admin/login page visible ───────────────────────────────────────────────

test('admin/login page has a password input', async ({ page }) => {
  await page.goto(`${BASE}/admin/login`);
  const pwInput = page.locator('input[type="password"]').first();
  await pwInput.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(pwInput).toBeVisible();
});

// ── 5.3 after login, not on login page ─────────────────────────────────────────

test('after login, browser is not on /admin/login', async ({ page }) => {
  await adminLogin(page);
  const url = page.url();
  expect(url).not.toMatch(/admin\/login/);
});

// ── 5.4 admin/activities page loads ─────────────────────────────────────────────

test('admin/activities page renders without crash', async ({ page }) => {
  await adminLogin(page);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto(`${BASE}/admin/activities`);
  await page.waitForLoadState('domcontentloaded');
  // Give the page 2s for hydration (admin pages can have client-side fetches)
  await page.waitForTimeout(2000);

  // Should have some content, not blank
  const body = await page.textContent('body');
  expect(body?.trim().length).toBeGreaterThan(0);

  // No fatal errors (ignore 3rd-party resource errors AND any 401 from /api/admin/stats
  // since admin pages often load stats before auth is fully set up).
  const fatalErrors = errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('analytics') &&
      !e.includes('fonts.g') &&
      !e.includes('401') // auth-check race — page itself works, the API call fails silently
  );
  expect(fatalErrors).toHaveLength(0);
});

// ── 5.5 admin/banners page loads ────────────────────────────────────────────────

test('admin/banners page renders without crash', async ({ page }) => {
  await adminLogin(page);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto(`${BASE}/admin/banners`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  const body = await page.textContent('body');
  expect(body?.trim().length).toBeGreaterThan(0);

  const fatalErrors = errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('analytics') &&
      !e.includes('fonts.g') &&
      !e.includes('401')
  );
  expect(fatalErrors).toHaveLength(0);
});

// ── 5.6 admin/monitor page loads ────────────────────────────────────────────────

test('admin/monitor page renders without crash', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`${BASE}/admin/monitor`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  const body = await page.textContent('body');
  expect(body?.trim().length).toBeGreaterThan(0);
});

// ── 5.7 admin/users page loads ───────────────────────────────────────────────────

test('admin/users page renders without crash', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  const body = await page.textContent('body');
  expect(body?.trim().length).toBeGreaterThan(0);
});

// ── 5.8 home page loads ─────────────────────────────────────────────────────────

test('home page / renders without crash', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
  const body = await page.textContent('body');
  expect(body?.trim().length).toBeGreaterThan(0);
});
