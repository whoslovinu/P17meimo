const BASE_URL = process.env.STRESS_BASE_URL || 'http://localhost:3000';
const TARGET_URL = `${BASE_URL}/api/action/attack`;
const TOTAL_REQUESTS = 1000;
const UNIQUE_USERS = 100;

// Import UUIDs from seeder for consistency
const { TEST_UUIDS } = require('./seed_db.js');

async function fireAttack(uid, nonce, itemType) {
  const res = await fetch(TARGET_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer uid:${uid}`,
    },
    body: JSON.stringify({ item_type: itemType, nonce }),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  return { status: res.status, body };
}

async function main() {
  const users = TEST_UUIDS;
  const tasks = [];

  for (let i = 0; i < TOTAL_REQUESTS; i += 1) {
    const uid = users[i % UNIQUE_USERS];
    const itemType = i % 2 === 0 ? 'item_hand' : 'item_phallus';

    // Deliberately reuse nonce per user to validate idempotency blocking.
    const nonceBucket = Math.floor((i % 100) / 20);
    const nonce = `nonce-${uid}-${nonceBucket}`;

    tasks.push(fireAttack(uid, nonce, itemType));
  }

  const results = await Promise.all(tasks);

  let success = 0;
  let casFailures = 0;
  let idemBlocks = 0;
  let otherFailures = 0;
  let minObservedHp = Number.POSITIVE_INFINITY;

  for (const result of results) {
    if (result.status === 200) {
      success += 1;
      const hp = result.body?.data?.boss_current_hp;
      if (typeof hp === 'number') {
        minObservedHp = Math.min(minObservedHp, hp);
      }
      continue;
    }

    const code = result.body?.error?.code;
    if (result.status === 409 && code === 'IDEMPOTENCY_BLOCK') {
      idemBlocks += 1;
    } else if (result.status === 409 && (code === 'CAS_FAILURE' || code === 'INSUFFICIENT_ITEM')) {
      casFailures += 1;
    } else {
      otherFailures += 1;
    }
  }

  if (!Number.isFinite(minObservedHp)) {
    minObservedHp = 0;
  }

  console.log('=== Stress Test Result ===');
  console.log(`Target: ${TARGET_URL}`);
  console.log(`Total Requests: ${TOTAL_REQUESTS}`);
  console.log(`Unique Users: ${UNIQUE_USERS}`);
  console.log(`Success: ${success}`);
  console.log(`CAS Failures: ${casFailures}`);
  console.log(`Idempotency Blocks: ${idemBlocks}`);
  console.log(`Other Failures: ${otherFailures}`);
  console.log(`Min Observed Boss HP: ${minObservedHp}`);

  if (minObservedHp < 0) {
    throw new Error(`Boss HP dropped below 0: ${minObservedHp}`);
  }

  console.log('Assertion passed: Boss HP never dropped below 0.');
}

main().catch((error) => {
  console.error('Stress test failed:', error?.message || error);
  process.exit(1);
});
