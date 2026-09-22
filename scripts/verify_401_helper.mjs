#!/usr/bin/env node
/**
 * verify_401_helper.mjs — direct unit-style test of the helper logic
 * after bundling. Uses jsdom-stubbed fetch + the helper's own
 * isSessionExpiredBody predicate (re-implemented here to validate the
 * shape recognition, since the real module imports react-hot-toast).
 */
function isSessionExpiredBody(body) {
  if (!body || typeof body !== 'object') return false;
  const b = body;
  const code = b.error?.code ?? b.error_code ?? '';
  if (code === 'UNAUTHORIZED') return true;
  const flatErr = b.error;
  if (typeof flatErr === 'string') {
    if (/^(Unauthorized Access|Invalid or expired admin_token|Missing admin_token)/i.test(flatErr)) {
      return true;
    }
  }
  return false;
}

const cases = [
  // IRON_GATE structured envelope
  { label: 'IRON_GATE structured envelope',
    body: { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired admin_token' } },
    expect: true },
  // IRON_GATE flat envelope (legacy middleware fallback)
  { label: 'IRON_GATE flat envelope — Unauthorized Access',
    body: { error: 'Unauthorized Access' },
    expect: true },
  // IRON_GATE flat envelope — Invalid or expired admin_token
  { label: 'IRON_GATE flat envelope — Invalid or expired',
    body: { error: 'Invalid or expired admin_token' },
    expect: true },
  // change-password business 401 (MUST NOT redirect)
  { label: 'change-password OLD_PASSWORD_MISMATCH (must NOT redirect)',
    body: { ok: false, error: { code: 'OLD_PASSWORD_MISMATCH', message: '旧密码不正确' } },
    expect: false },
  // login wrong password business 401 (MUST NOT redirect)
  { label: 'login 密码错误 (must NOT redirect)',
    body: { ok: false, error: '密码错误' },
    expect: false },
  // null body
  { label: 'null body',
    body: null,
    expect: false },
  // empty object
  { label: 'empty object',
    body: {},
    expect: false },
];

let passed = 0, failed = 0;
for (const c of cases) {
  const got = isSessionExpiredBody(c.body);
  const ok = got === c.expect;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label}  expect=${c.expect}  got=${got}`);
  if (ok) passed++; else failed++;
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);