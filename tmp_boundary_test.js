// ISSUE 1 — 4 boundary test scenarios for the "距下一奖励" algorithm
// This is a pure logic test, no DB needed

function computeNextDamage(rewards, personalDamage) {
  const eligibleRewards = rewards
    .filter(r => !r.locked && r.damage > personalDamage)
    .sort((a, b) => a.damage - b.damage);
  const nextThresholdReward = eligibleRewards[0] ?? null;
  const damageToNext = nextThresholdReward
    ? nextThresholdReward.damage - personalDamage
    : 0;
  return { nextThresholdReward, damageToNext };
}

function makeReward(id, damage, unlocked, claimed, locked) {
  return { id, damage, unlocked, claimed, locked };
}

const thresholds = [2, 3, 4, 10000];

console.log("=== ISSUE 1 — 4 Boundary Tests ===\n");

// SCENARIO 1: damage=699, thresholds 2/3/4/10000 → expect 9301
{
  const rewards = [
    makeReward(1, 2,  true,  false, false), // unlocked, not claimed
    makeReward(2, 3,  true,  false, false), // unlocked, not claimed
    makeReward(3, 4,  true,  false, false), // unlocked, not claimed
    makeReward(4, 10000, false, false, false), // not unlocked yet
  ];
  const pd = 699;
  const { nextThresholdReward, damageToNext } = computeNextDamage(rewards, pd);
  console.log("SCENARIO 1: damage=699, thresholds 2/3/4/10000");
  console.log("  Expected: damageToNext = 9301");
  console.log("  Actual:   damageToNext = " + damageToNext);
  console.log("  PASS: " + (damageToNext === 9301 ? "✅" : "❌"));
  console.log("  nextReward: " + (nextThresholdReward ? "threshold=" + nextThresholdReward.damage : "null"));
  console.log();
}

// SCENARIO 2: damage=10000, all thresholds reached, ALL claimed → "全部进度奖励已达成"
{
  const rewards = [
    makeReward(1, 2,    false, true,  false), // reached, claimed
    makeReward(2, 3,    false, true,  false), // reached, claimed
    makeReward(3, 4,    false, true,  false), // reached, claimed
    makeReward(4, 10000, false, true,  false), // reached, claimed
  ];
  const pd = 10000;
  const { nextThresholdReward, damageToNext } = computeNextDamage(rewards, pd);
  console.log("SCENARIO 2: damage=10000, all claimed");
  console.log("  Expected: nextReward=null, damageToNext=0 → UI shows '全部进度奖励已达成'");
  console.log("  Actual:   nextReward=" + (nextThresholdReward ? "threshold=" + nextThresholdReward.damage : "null") + ", damageToNext=" + damageToNext);
  console.log("  PASS: " + (nextThresholdReward === null && damageToNext === 0 ? "✅" : "❌"));
  console.log();
}

// SCENARIO 3: damage=10000, all thresholds reached, NOT all claimed → "有奖励可领取"
{
  const rewards = [
    makeReward(1, 2,    true,  false, false), // reached, unlocked, NOT claimed
    makeReward(2, 3,    false, true,  false), // reached, claimed
    makeReward(3, 4,    false, true,  false), // reached, claimed
    makeReward(4, 10000, false, true,  false), // reached, claimed
  ];
  const pd = 10000;
  const { nextThresholdReward, damageToNext } = computeNextDamage(rewards, pd);
  console.log("SCENARIO 3: damage=10000, threshold=2 reachable but NOT claimed");
  console.log("  Expected: nextReward=threshold=2, damageToNext=0 → '有奖励可领取'");
  console.log("  Actual:   nextReward=" + (nextThresholdReward ? "threshold=" + nextThresholdReward.damage : "null") + ", damageToNext=" + damageToNext);
  console.log("  PASS: " + (nextThresholdReward !== null && nextThresholdReward.damage === 2 && damageToNext === 0 ? "✅" : "❌"));
  console.log();
}

// SCENARIO 4: next threshold is LOCKED → skip to next reachable
{
  const rewards = [
    makeReward(1, 2,    true,  false, false), // unlocked, not claimed
    makeReward(2, 3,    false, false, true),  // LOCKED
    makeReward(3, 10000, false, false, false), // reachable, not locked
  ];
  const pd = 3;
  const { nextThresholdReward, damageToNext } = computeNextDamage(rewards, pd);
  console.log("SCENARIO 4: threshold=3 is LOCKED, skip to threshold=10000");
  console.log("  Expected: nextReward=threshold=10000, damageToNext=9997");
  console.log("  Actual:   nextReward=" + (nextThresholdReward ? "threshold=" + nextThresholdReward.damage : "null") + ", damageToNext=" + damageToNext);
  console.log("  PASS: " + (nextThresholdReward !== null && nextThresholdReward.damage === 10000 && damageToNext === 9997 ? "✅" : "❌"));
  console.log();
}

// EXTRA: All rewards locked → no reachable reward
{
  const rewards = [
    makeReward(1, 2,    false, false, true),  // locked
    makeReward(2, 10000, false, false, true), // locked
  ];
  const pd = 0;
  const { nextThresholdReward, damageToNext } = computeNextDamage(rewards, pd);
  console.log("EXTRA: All rewards LOCKED → no reachable reward");
  console.log("  Expected: nextReward=null → UI shows '全部进度奖励已达成'");
  console.log("  Actual:   nextReward=" + (nextThresholdReward ? "threshold=" + nextThresholdReward.damage : "null"));
  console.log("  PASS: " + (nextThresholdReward === null ? "✅" : "❌"));
  console.log();
}

// EXTRA: Personal damage EXACTLY at a threshold
{
  const rewards = [
    makeReward(1, 100, false, false, false),
    makeReward(2, 200, false, false, false),
  ];
  const pd = 100;
  const { nextThresholdReward, damageToNext } = computeNextDamage(rewards, pd);
  console.log("EXTRA: damage=100, threshold=100 (NOT >, so NOT eligible)");
  console.log("  Expected: nextReward=threshold=200, damageToNext=100");
  console.log("  Actual:   nextReward=" + (nextThresholdReward ? "threshold=" + nextThresholdReward.damage : "null") + ", damageToNext=" + damageToNext);
  console.log("  PASS: " + (nextThresholdReward !== null && nextThresholdReward.damage === 200 && damageToNext === 100 ? "✅" : "❌"));
}
