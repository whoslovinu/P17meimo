// 隔离测试 adminFetch 错误路径
// 完全本地，不联网、不碰生产

import { adminFetch } from '../app/admin/lib/adminApi';

type Case = {
  label: string;
  setup: (origFetch: typeof fetch) => void;
  expectContains?: string;
  expectExactJson?: object;
  expectThrows?: boolean;
};

const cases: Case[] = [
  {
    label: 'Case 1: HTTP 409 + ALREADY_CLAIMED JSON',
    setup: (origFetch) => {
      (globalThis as any).fetch = async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'ALREADY_CLAIMED',
              message: '该奖励已领取，锁定不能撤销已发奖励',
            },
          }),
          { status: 409, statusText: 'Conflict', headers: { 'Content-Type': 'application/json' } },
        );
    },
  },
  {
    label: 'Case 2: HTTP 500 with safe business message',
    setup: (origFetch) => {
      (globalThis as any).fetch = async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: '操作失败，请稍后重试',
            },
          }),
          { status: 500, statusText: 'Internal Server Error', headers: { 'Content-Type': 'application/json' } },
        );
    },
  },
  {
    label: 'Case 3: Network failure (fetch throws TypeError)',
    setup: (origFetch) => {
      (globalThis as any).fetch = async () => {
        throw new TypeError('Failed to fetch');
      };
    },
  },
  {
    label: 'Case 4: HTTP 500 returning non-JSON (HTML error page)',
    setup: (origFetch) => {
      (globalThis as any).fetch = async () =>
        new Response('<html><body>Internal Server Error</body></html>', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'text/html' },
        });
    },
  },
];

async function runOne(c: Case): Promise<void> {
  console.log('\n' + '='.repeat(70));
  console.log(c.label);
  console.log('='.repeat(70));
  const origFetch = globalThis.fetch;
  c.setup(origFetch);
  let thrown: unknown = null;
  let parsed: any = null;
  let status = -1;
  let rawBodyText = '';
  try {
    const res = await adminFetch('https://mock.local/api/admin/users/u/milestones/override', {
      method: 'POST',
      body: JSON.stringify({ milestoneId: 1789426210, action: 'lock', reason: 'test' }),
    });
    status = res.status;
    rawBodyText = await res.text();
    parsed = JSON.parse(rawBodyText);
    console.log('  res.status =', status);
    console.log('  raw body   =', rawBodyText);
    console.log('  parsed     =', JSON.stringify(parsed));
  } catch (e) {
    thrown = e;
    console.log('  THREW:', e instanceof Error ? e.message : String(e));
  }
  // verification
  if (!thrown) {
    if (parsed?.error?.code === 'ALREADY_CLAIMED' && parsed?.error?.message?.includes('锁定不能撤销已发奖励')) {
      console.log('  >>> VERDICT: PRESERVED real API message ✅');
    } else if (parsed?.error?.code === 'HTTP_NON_2XX') {
      console.log('  >>> VERDICT: ORIGINAL API MESSAGE LOST ❌ (replaced by HTTP_NON_2XX generic)');
      console.log('      generic message =', parsed?.error?.message);
    } else if (parsed?.error?.code === 'INTERNAL_ERROR' && parsed?.error?.message === '操作失败，请稍后重试') {
      console.log('  >>> VERDICT: PRESERVED real API message ✅');
    } else if (parsed?.error?.code === 'NETWORK') {
      console.log('  >>> VERDICT: NETWORK ERROR (expected for Case 3) ✅');
    } else if (parsed?.error?.code === 'BAD_JSON') {
      console.log('  >>> VERDICT: BAD_JSON (expected for Case 4) ✅');
    } else {
      console.log('  >>> VERDICT: UNKNOWN shape', JSON.stringify(parsed));
    }
  }
  (globalThis as any).fetch = origFetch;
}

(async () => {
  for (const c of cases) {
    await runOne(c);
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
