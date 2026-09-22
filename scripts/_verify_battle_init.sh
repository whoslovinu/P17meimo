#!/usr/bin/env bash
curl -s -H "Cookie: uid=uid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" "http://localhost:3000/api/battle/init" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  try {
    const parsed = JSON.parse(d);
    console.log('=== taskConfig (should be 元) ===');
    console.log(JSON.stringify(parsed.data.taskConfig, null, 2));
    console.log('=== user.tasks.daily_recharge (should be 元) ===');
    console.log(JSON.stringify(parsed.data.user.tasks.daily_recharge, null, 2));
    const t = parsed.data.user.tasks.daily_recharge;
    console.log('');
    console.log('=== Verification ===');
    console.log('  Threshold (元):', t.targetThreshold);
    console.log('  Progress (元): ', t.currentProgress);
    console.log('  Claimed:       ', t.isClaimed);
    console.log('');
    console.log('  H5 task panel will display: 单日充值满 ' + t.targetThreshold + ' 元');
    console.log('  H5 progress bar: ' + t.currentProgress + ' / ' + t.targetThreshold);
  } catch (e) { console.log('parse error:', e.message, d.slice(0, 500)); }
});
"