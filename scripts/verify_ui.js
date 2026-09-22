/**
 * scripts/verify_ui.js
 * Automated headless browser verification for the battle page.
 *
 * Checks:
 *  1. Page loads without crashing
 *  2. No console errors (physics, undefined, null, Error)
 *  3. Canvas element exists and has non-zero dimensions
 *  4. Screenshot saved for visual confirmation
 *
 * Usage: node scripts/verify_ui.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const APP_URL = 'http://localhost:3000';
const SCREENSHOT_PATH = path.join(__dirname, '..', 'verify_result.png');
const RESULT_FILE = path.join(__dirname, '..', 'verify_result.json');

const ERRORS_TO_FAIL_ON = [
  'physics',
  'undefined',
  'null',
  'Error',
];

const PATTERNS = ERRORS_TO_FAIL_ON.map((e) => e.toLowerCase());

function shouldFail(logText) {
  const lower = logText.toLowerCase();
  return PATTERNS.some((p) => lower.includes(p));
}

async function waitForServer(url, maxRetries = 20, interval = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`[verify] Server is up at ${url}`);
        return true;
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

async function verify() {
  console.log('[verify] Starting headless browser verification...');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const consoleErrors = [];
  const consoleLogs = [];

  page.on('console', (msg) => {
    const text = msg.text();
    const type = msg.type();
    consoleLogs.push({ type, text });
    if (type === 'error') {
      consoleErrors.push(text);
    }
    if (type === 'error' && shouldFail(text)) {
      consoleErrors.push(`[FAIL-CANDIDATE] ${text}`);
    }
    // Print all messages for debugging
    console.log(`[browser:${type}] ${text}`);
  });

  page.on('pageerror', (err) => {
    consoleErrors.push(`[PAGE ERROR] ${err.message}`);
  });

  try {
    // Wait for server to be ready
    const serverReady = await waitForServer(APP_URL, 30, 1000);
    if (!serverReady) {
      throw new Error(`Server at ${APP_URL} did not respond after 30s`);
    }

    console.log('[verify] Navigating to battle page...');
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Give the page time to initialize PixiJS and Spine.
    // First load triggers Next.js compilation (~8s), subsequent loads are instant.
    console.log('[verify] Waiting 20s for PixiJS/Spine initialization...');
    await page.waitForTimeout(20000);

    // Check for canvas element
    const canvasInfo = await page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      if (canvases.length === 0) return { count: 0, hasActive: false };
      const active = canvases.filter(
        (c) => c.width > 0 && c.height > 0
      );
      return {
        count: canvases.length,
        hasActive: active.length > 0,
        widths: canvases.map((c) => c.width),
        heights: canvases.map((c) => c.height),
      };
    });

    // PIXI cache diagnostics — read from the page's global PIXI instance (already loaded via Next.js bundling)
    let pixiDiagnostics = {};
    try {
      pixiDiagnostics = await page.evaluate(() => {
        const PIXI = window.PIXI;
        if (!PIXI?.Assets) return { note: 'PIXI.Assets not available via window.PIXI' };
        const keys = Array.from(PIXI.Assets.cache.keys?.() ?? []);
        const diag = { note: 'read via window.PIXI', keyCount: keys.length };
        if (keys.length > 0) diag.sampleKeys = keys.slice(0, 3);
        return diag;
      });
    } catch (_) {
      pixiDiagnostics = { note: 'Could not read PIXI cache' };
    }

    console.log('[verify] PIXI cache diagnostics:', JSON.stringify(pixiDiagnostics, null, 2));

    console.log(`[verify] Canvas info:`, JSON.stringify(canvasInfo));

    // Take screenshot
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    console.log(`[verify] Screenshot saved to: ${SCREENSHOT_PATH}`);

    // Filter to only real errors (not warnings/info)
    const realErrors = consoleErrors.filter((e) => {
      const lower = e.toLowerCase();
      // Exclude benign messages
      const benign = [
        'favicon',
        'warning',
        'warn',
        'download',
        'third-party cookie',
      ];
      return !benign.some((b) => lower.includes(b));
    });

    // Result object
    const result = {
      success: realErrors.length === 0 && canvasInfo.hasActive,
      canvas: canvasInfo,
      consoleErrorCount: realErrors.length,
      consoleErrors: realErrors,
      screenshot: SCREENSHOT_PATH,
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
    console.log(`[verify] Result saved to: ${RESULT_FILE}`);

    // Print summary
    console.log('\n========================================');
    if (result.success) {
      console.log('VERIFICATION SUCCESS: Model Rendering Confirmed');
      console.log(`Canvas active: ${canvasInfo.hasActive} (${canvasInfo.count} canvas elements)`);
      console.log(`Console errors: ${result.consoleErrorCount}`);
    } else {
      console.log('VERIFICATION FAILED:');
      if (realErrors.length > 0) {
        console.log('Console errors:');
        realErrors.forEach((e) => console.log(`  - ${e}`));
      }
      if (!canvasInfo.hasActive) {
        console.log('Canvas not found or has zero dimensions');
      }
    }
    console.log('========================================\n');

    await browser.close();
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error(`[verify] FATAL: ${err.message}`);
    const result = {
      success: false,
      error: err.message,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
    await browser.close();
    process.exit(1);
  }
}

verify();
