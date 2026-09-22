#!/usr/bin/env node
/**
 * scripts/simulate-webhook.mjs
 *
 * 本地模拟"主站"向 H5 发送充值/消费事件，用于端到端自测。
 * 生成正确的 HMAC-SHA256 签名（与生产端 verifyWebhookSignature 同算法）。
 *
 * ⚠️ 注意：
 *   - 本脚本**不知道生产环境 WEBHOOK_SECRET**，请通过 --secret 显式传入。
 *   - 默认目标 http://localhost:3000。线上请加 --url=http://98.93.252.250:3000。
 *   - 每个 tx_id 默认加时间戳后缀，避免 Redis idempotency 拦截重复事件。
 *
 * Usage:
 *   node scripts/simulate-webhook.mjs --type recharge --uid 128 --amount 5000
 *   node scripts/simulate-webhook.mjs --type consume  --uid 128 --amount 40
 *   node scripts/simulate-webhook.mjs --type recharge --uid 128 --amount 5000 \
 *     --url http://98.93.252.250:3000 --secret <PROD_WEBHOOK_SECRET>
 *
 * 通用开关：
 *   --type    recharge | consume              (必填)
 *   --uid     主站长 ID（如 128）              (必填)
 *   --amount  金额（分，电量也走 amount）       (可选，默认 recharge=5000 / consume=40)
 *   --url     目标 base URL                    (默认 http://localhost:3000)
 *   --secret  WEBHOOK_SECRET                   (默认从 process.env.WEBHOOK_SECRET 读，再退回 .env.local)
 *   --tx-id   自定义 tx_id                     (默认 SIM_<type>_<uid>_<timestamp>)
 *   --main-id 显式附加 main_station_user_id   (可选)
 *   --dry-run 只打印 payload + sig 不发送
 */

import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// ── 解析参数 ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] ?? true;
  }
  return out;
}

const args = parseArgs(process.argv);
const type = String(args.type ?? '');
if (!['recharge', 'consume'].includes(type)) {
  console.error('❌ --type 必须是 recharge 或 consume');
  process.exit(2);
}
const uid = String(args.uid ?? '');
if (!uid) {
  console.error('❌ 缺少 --uid');
  process.exit(2);
}
const amount = Number(args.amount ?? (type === 'recharge' ? 5000 : 40));
if (!Number.isInteger(amount) || amount <= 0) {
  console.error('❌ --amount 必须是正整数');
  process.exit(2);
}

const baseUrl = String(args.url ?? 'http://localhost:3000').replace(/\/+$/, '');
const targetUrl = `${baseUrl}/api/webhook/user-action`;

// ── 取 secret：CLI > ENV > .env.local ────────────────────────────────────────
function loadSecretFromEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return undefined;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^WEBHOOK_SECRET\s*=\s*"?([^"\s]+)"?\s*$/);
    if (m) return m[1];
  }
  return undefined;
}

const secret = args.secret
  ? String(args.secret)
  : (process.env.WEBHOOK_SECRET ?? loadSecretFromEnvLocal());

if (!secret) {
  console.error('❌ 找不到 WEBHOOK_SECRET。请：');
  console.error('   · 显式传入 --secret=<value>');
  console.error('   · 或设置 process.env.WEBHOOK_SECRET');
  console.error('   · 或在 .env.local 写 WEBHOOK_SECRET=...');
  process.exit(2);
}

// ── 组装 payload ────────────────────────────────────────────────────────────
const txId = String(args['tx-id'] ?? `SIM_${type.toUpperCase()}_${uid}_${Date.now()}`);
const timestamp = Date.now();
const mainStationUserId = args['main-id'] ? String(args['main-id']) : undefined;

// 使用稳定 key 顺序的 JSON 序列化（与服务端 JSON.parse 拿到的字节级一致）
// 注意：服务端对 rawBody 整体做 HMAC，所以 sign 字段必须以"占位 64 个 0"形式
// 进入 rawBody；服务端拿到 rawBody 再算 HMAC，与我们 header 提交的 sig 才能匹配。
// 这是和真实主站一致的签名约定（见 ACTIVE_CONTEXT §5 webhook 鉴权说明）。
const ZERO_SIGN = '0'.repeat(64);
const payload = {
  action_type: type,
  amount,
  sign: ZERO_SIGN, // 占位，用于 HMAC
  timestamp,
  tx_id: txId,
  user_id: uid,
};
if (mainStationUserId) payload.main_station_user_id = mainStationUserId;

function canonicalStringify(obj) {
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

const rawBody = canonicalStringify(payload);
const hmac = createHmac('sha256', secret);
hmac.update(rawBody, 'utf8');
const sig = hmac.digest('hex');

console.log('┌─────────────────────────────────────────────────────────');
console.log('│ 🚀  Webhook 模拟发送');
console.log('├─────────────────────────────────────────────────────────');
console.log(`│ type        : ${type}`);
console.log(`│ uid         : ${uid}`);
console.log(`│ amount      : ${amount} (${type === 'recharge' ? '分' : '电量'})`);
console.log(`│ tx_id       : ${txId}`);
console.log(`│ timestamp   : ${timestamp}`);
if (mainStationUserId) console.log(`│ main_id     : ${mainStationUserId}`);
console.log(`│ target      : ${targetUrl}`);
console.log(`│ secret len  : ${secret.length} chars (${secret.slice(0, 4)}***)`);
console.log(`│ HMAC sig    : sha256=${sig}`);
console.log('├─────────────────────────────────────────────────────────');
console.log(`│ rawBody     : ${rawBody}`);
console.log('└─────────────────────────────────────────────────────────');

// ── 本地自检：用同一段 rawBody 再算一次 HMAC ────────────────────────────────
{
  const verifyHmac = createHmac('sha256', secret);
  verifyHmac.update(rawBody, 'utf8');
  const verifySig = verifyHmac.digest('hex');
  if (verifySig !== sig) {
    console.error('❌ 自检失败：HMAC 不稳定');
    process.exit(3);
  }
  console.log('✅ 本地 HMAC 自检通过（确定性序列化）');
}

if (args['dry-run']) {
  console.log('🛑 --dry-run 模式：不实际发送');
  process.exit(0);
}

// ── 发送 ────────────────────────────────────────────────────────────────────
const signatureHeader = `sha256=${sig}`;

(async () => {
  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signatureHeader,
      },
      body: rawBody,
    });

    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    console.log('─────────────────────────────────────────────────────────');
    console.log(`📬  响应: HTTP ${res.status}`);
    console.log(JSON.stringify(body, null, 2));
    console.log('─────────────────────────────────────────────────────────');

    if (res.status === 401) {
      console.error('💡 401 通常是签名不通过。请检查：');
      console.error('   · --secret 是否与目标服务器 WEBHOOK_SECRET 完全一致');
      console.error('   · 目标服务器 NODE_ENV=production 且 WEBHOOK_SECRET 已配置');
    } else if (res.status === 200 && body?.message === 'Already processed') {
      console.log('ℹ️  Redis 命中幂等（之前已处理过同一 tx_id）。等 24h 或换 tx-id 再试。');
    } else if (res.status === 200 && body?.message === 'success') {
      console.log('🎉 充值/消费事件已被服务端接受。打开 H5 看 HP/任务进度是否刷新。');
    }
    process.exit(res.ok ? 0 : 1);
  } catch (e) {
    console.error('❌ 请求失败:', e?.message ?? e);
    process.exit(1);
  }
})();