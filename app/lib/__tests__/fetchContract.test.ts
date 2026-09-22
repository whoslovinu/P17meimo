/**
 * app/lib/__tests__/fetchContract.test.ts
 *
 * Network Layer Hard Rule (V6.0+) enforcement: NO bare `fetch(` in
 * `app/components/**` or `app/lib/**`. This is a static-audit test
 * that fails the build if a regression slips in.
 *
 * Allow-list (the wrappers themselves are allowed to use fetch):
 *   - app/lib/fetchWithTimeout.ts       (the canonical wrapper)
 *   - app/admin/lib/adminApi.ts         (adminFetch, internally calls fetchWithTimeout)
 *
 * Run with: `npm run test:unit`
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Recursively list .ts/.tsx files under a dir, excluding __tests__. */
function listClientFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry === '.next') continue;
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      listClientFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const ALLOWLIST = new Set([
  'app/lib/fetchWithTimeout.ts',
  'app/admin/lib/adminApi.ts',
]);

function isAllowlisted(file: string): boolean {
  const norm = file.replace(process.cwd(), '').replace(/\\/g, '/').replace(/^\/+/, '');
  return ALLOWLIST.has(norm);
}

/** Match a bare fetch call — NOT preceded by an identifier (e.g. myFetch, adminFetch). */
const BARE_FETCH_RE = /(^|[^a-zA-Z_$.])fetch\s*\(\s*['"]/m;

describe('Network Layer Hard Rule (V6.0+)', () => {
  test('no bare fetch("...") in app/components/**', () => {
    const offenders: { file: string; line: number; snippet: string }[] = [];
    const files = listClientFiles(join(process.cwd(), 'app', 'components'));

    for (const file of files) {
      if (isAllowlisted(file)) continue;
      const text = readFileSync(file, 'utf-8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (BARE_FETCH_RE.test(lines[i])) {
          offenders.push({
            file: file.replace(process.cwd(), '').replace(/\\/g, '/'),
            line: i + 1,
            snippet: lines[i].trim().slice(0, 80),
          });
        }
      }
    }

    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  test('no bare fetch("...") in app/lib/** and app/admin/lib/**', () => {
    const offenders: { file: string; line: number; snippet: string }[] = [];
    const roots = ['app/lib', 'app/admin/lib'];
    for (const root of roots) {
      const files = listClientFiles(join(process.cwd(), root));
      for (const file of files) {
        if (isAllowlisted(file)) continue;
        const text = readFileSync(file, 'utf-8');
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (BARE_FETCH_RE.test(lines[i])) {
            offenders.push({
              file: file.replace(process.cwd(), '').replace(/\\/g, '/'),
              line: i + 1,
              snippet: lines[i].trim().slice(0, 80),
            });
          }
        }
      }
    }

    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  test('no axios() calls anywhere in app/', () => {
    const offenders: { file: string; line: number }[] = [];
    const files = listClientFiles(join(process.cwd(), 'app'));

    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\baxios\s*\(/.test(lines[i]) || /\baxios\./.test(lines[i])) {
          offenders.push({
            file: file.replace(process.cwd(), '').replace(/\\/g, '/'),
            line: i + 1,
          });
        }
      }
    }

    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});