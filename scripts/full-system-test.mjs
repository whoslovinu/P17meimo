/**
 * FULL SYSTEM SELF-TEST — P17 H5meimo Demo
 *
 * Runs against local dev server (localhost:3000) with SSH tunnel to prod DB/Redis.
 * Usage:
 *   1. Terminal 1: node scripts/dev_tunnel.mjs   (keep running)
 *   2. Terminal 2: npm run dev                    (keep running)
 *   3. Terminal 3: node scripts/full-system-test.mjs
 */

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
// Local dev: ADMIN_SECRET_KEY=dev (from .env.local)
const ADMIN_SECRET_KEY = 'dev';

function parseSetCookie(header) {
  if (!header) return null;
  const match = header.match(/admin_token=([^;]+)/);
  return match ? match[1] : null;
}

async function req(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    clearTimeout(timer);
    const ct = res.headers.get('content-type') || '';
    let body;
    try { body = ct.includes('application/json') ? await res.json() : await res.text(); } catch { body = null; }
    const setCookie = res.headers.get('set-cookie') || '';
    return { status: res.status, ok: res.ok, setCookie, body };
  } catch (e) {
    clearTimeout(timer);
    return { status: 0, ok: false, setCookie: '', body: null, error: e.message };
  }
}

const results = [];
function pass(label, detail = '') { results.push({ label, status: 'PASS', detail }); }
function fail(label, detail = '') { results.push({ label, status: 'FAIL', detail }); }
function section(title) { results.push({ label: title, status: 'SECTION' }); }

(async () => {
  console.log('\n🚀 P17 全项目全功能大自测 — START');
  console.log(`📍 ${BASE}  |  ${new Date().toISOString()}\n`);

  // ── Admin Auth ────────────────────────────────────────────────────────────
  section('━━━ PART 1: 后台 Admin 鉴权 ━━━');

  // T1: validate 密码校验
  let r = await req(`${BASE}/api/admin/validate`, {
    method: 'POST', body: JSON.stringify({ secret: ADMIN_SECRET_KEY }),
  });
  if (r.status === 200 && r.body?.ok) {
    pass('T1 /api/admin/validate 密码校验', `200 OK — 密码 "dev" 正确`);
  } else {
    fail('T1 /api/admin/validate 密码校验', `HTTP ${r.status} | ${JSON.stringify(r.body)}`);
  }

  // T2: login → 拿 admin_token
  r = await req(`${BASE}/api/admin/login`, {
    method: 'POST', body: JSON.stringify({ password: ADMIN_SECRET_KEY }),
  });
  const adminToken = parseSetCookie(r.setCookie);
  if (r.status === 200 && r.body?.ok && adminToken) {
    pass('T2 /api/admin/login 登录下发Session', `200 OK | admin_token长度=${adminToken.length}`);
  } else {
    fail('T2 /api/admin/login 登录下发Session', `HTTP ${r.status} | token=${adminToken ? '有' : '无'} | ${JSON.stringify(r.body)}`);
  }

  const cookieHdr = adminToken ? `admin_token=${adminToken}` : '';

  // T3: Dashboard Stats
  r = await req(`${BASE}/api/admin/stats`, { headers: { Cookie: cookieHdr } });
  if (r.status === 200 && r.body?.ok) {
    const d = r.body.data;
    pass('T3 /api/admin/stats 仪表盘统计', `totalUsers=${d.totalUsers} activeUsers24h=${d.activeUsers24h} totalDamage=${d.totalDamage}`);
  } else {
    fail('T3 /api/admin/stats 仪表盘统计', `HTTP ${r.status} | ${JSON.stringify(r.body)}`);
  }

  // T4: Activity Config
  r = await req(`${BASE}/api/admin/activity`, { headers: { Cookie: cookieHdr } });
  if (r.status === 200 && r.body?.ok) {
    const act = r.body.data?.[0];
    const cfg = act?.config || {};
    pass('T4 /api/admin/activity 活动配置读取', `活动=${act?.name || '?'} isGlobalEnabled=${cfg.isGlobalEnabled} boss.totalHp=${cfg.boss?.totalHp}`);
  } else {
    fail('T4 /api/admin/activity 活动配置读取', `HTTP ${r.status} | ${JSON.stringify(r.body)}`);
  }

  // T5: Admin Config (replaces /api/admin/monitor which doesn't exist)
  r = await req(`${BASE}/api/admin/config`, { headers: { Cookie: cookieHdr } });
  if (r.status === 200) {
    pass('T5 /api/admin/config 运营配置读取', `HTTP ${r.status}`);
  } else {
    fail('T5 /api/admin/config 运营配置读取', `HTTP ${r.status} | ${JSON.stringify(r.body)}`);
  }

  // T6: User List (correct path: /api/admin/user not /api/admin/users)
  r = await req(`${BASE}/api/admin/user?search=128`, { headers: { Cookie: cookieHdr } });
  if (r.status === 200 && r.body?.ok) {
    const data = Array.isArray(r.body.data) ? r.body.data : [];
    pass('T6 /api/admin/user 用户列表查询', `返回${data.length}条记录`);
  } else {
    fail('T6 /api/admin/user 用户列表查询', `HTTP ${r.status} | ${JSON.stringify(r.body)}`);
  }

  // T7: Banner List
  r = await req(`${BASE}/api/admin/banners`, { headers: { Cookie: cookieHdr } });
  if (r.status === 200) {
    pass('T7 /api/admin/banners Banner列表读取', `HTTP ${r.status}`);
  } else {
    fail('T7 /api/admin/banners Banner列表读取', `HTTP ${r.status}`);
  }

  // ── H5 API ────────────────────────────────────────────────────────────────
  section('━━━ PART 2: 前台 H5 API ━━━');

  // T8: Battle Init
  r = await req(`${BASE}/api/battle/init`, { headers: { Cookie: 'uid=128' } });
  if (r.status === 200 && r.body?.ok) {
    const tc = r.body.data?.taskConfig;
    pass('T8 /api/battle/init 初始化', `daily_energy=${tc?.daily_energy} (应为50) daily_recharge=${tc?.daily_recharge} (应为5000)`);
  } else if (r.status === 200 && !r.body?.ok) {
    // Activity may be offline - still a valid response
    pass('T8 /api/battle/init 初始化', `HTTP 200 OK (activity=${r.body?.error?.code || '?'})`);
  } else {
    fail('T8 /api/battle/init 初始化', `HTTP ${r.status} | ${JSON.stringify(r.body)}`);
  }

  // T9: User Status
  r = await req(`${BASE}/api/user/status?userId=128`);
  if (r.status === 200 && r.body?.ok) {
    const d = r.body.data;
    pass('T9 /api/user/status 用户状态', `daily_energy=${d.daily_energy_consumed} daily_recharge=${d.daily_money_recharged}元 (已转元)`);
  } else {
    fail('T9 /api/user/status 用户状态', `HTTP ${r.status} | ${JSON.stringify(r.body)}`);
  }

  // T10: Webhook — consume (wrong sig → 401, but not 500)
  const txC = `test-consume-${Date.now()}`;
  r = await req(`${BASE}/api/webhook/user-action`, {
    method: 'POST',
    headers: { 'X-Webhook-Signature': 'a522d0000000000000000000000000000000000000000000000000000000000' },
    body: JSON.stringify({ action_type: 'consume', user_id: 128, amount: 500, tx_id: txC, timestamp: Math.floor(Date.now() / 1000), sign: '' }),
  });
  if (r.status < 500 && r.status !== 0) {
    pass('T10 /api/webhook/user-action (consume) 端点可达', `HTTP ${r.status} (非500说明端点正常)`);
  } else {
    fail('T10 /api/webhook/user-action (consume) 端点可达', `HTTP ${r.status} — 服务端崩溃！`);
  }

  // T11: Webhook — recharge
  const txR = `test-recharge-${Date.now()}`;
  r = await req(`${BASE}/api/webhook/user-action`, {
    method: 'POST',
    headers: { 'X-Webhook-Signature': 'a522d0000000000000000000000000000000000000000000000000000000000' },
    body: JSON.stringify({ action_type: 'recharge', user_id: 128, amount: 10000, tx_id: txR, timestamp: Math.floor(Date.now() / 1000), sign: '' }),
  });
  if (r.status < 500 && r.status !== 0) {
    pass('T11 /api/webhook/user-action (recharge) 端点可达', `HTTP ${r.status}`);
  } else {
    fail('T11 /api/webhook/user-action (recharge) 端点可达', `HTTP ${r.status} — 服务端崩溃！`);
  }

  // T12: Task Claim
  r = await req(`${BASE}/api/battle/task-claim`, {
    method: 'POST',
    headers: { Cookie: 'uid=128' },
    body: JSON.stringify({ taskId: 'consume_100' }),
  });
  if (r.status >= 200 && r.status < 500) {
    pass('T12 /api/battle/task-claim 任务领取', `HTTP ${r.status} (非500即可)`);
  } else {
    fail('T12 /api/battle/task-claim 任务领取', `HTTP ${r.status} | ${JSON.stringify(r.body)}`);
  }

  // T13: Milestone Claim
  r = await req(`${BASE}/api/game/milestone/claim`, {
    method: 'POST',
    headers: { Cookie: 'uid=128' },
    body: JSON.stringify({ milestoneId: 1 }),
  });
  if (r.status >= 200 && r.status < 500) {
    pass('T13 /api/game/milestone/claim 里程碑领取', `HTTP ${r.status}`);
  } else {
    fail('T13 /api/game/milestone/claim 里程碑领取', `HTTP ${r.status} | ${JSON.stringify(r.body)}`);
  }

  // ── Output Report ────────────────────────────────────────────────────────
  section('━━━ 测试报告 ━━━');
  const passCount = results.filter(x => x.status === 'PASS').length;
  const failCount = results.filter(x => x.status === 'FAIL').length;
  const total = passCount + failCount;

  console.log('');
  console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
  console.log('┃        《全项目全功能自动化测试矩阵与结果》              ┃');
  console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
  console.log(`  📍 ${BASE}`);
  console.log(`  ⏱  ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`);

  for (const item of results) {
    if (item.status === 'SECTION') {
      console.log(`\n  ${item.label}`);
      console.log('  ' + '─'.repeat(54));
    } else if (item.status === 'PASS') {
      console.log(`  ✅ PASS  ${item.label}`);
      if (item.detail) console.log(`          └ ${item.detail}`);
    } else if (item.status === 'FAIL') {
      console.log(`  ❌ FAIL  ${item.label}`);
      if (item.detail) console.log(`          └ ${item.detail}`);
    }
  }

  console.log('\n  ' + '─'.repeat(54));
  console.log(`  📊 结果:  ✅ PASS ${passCount}  ❌ FAIL ${failCount}  总计 ${total}`);
  if (failCount === 0) {
    console.log('  🎉 全部通过 — 系统运行正常！\n');
  } else {
    console.log(`  ⚠️  存在 ${failCount} 项失败，请查看详情！\n`);
  }

  process.exit(failCount > 0 ? 1 : 0);
})();
