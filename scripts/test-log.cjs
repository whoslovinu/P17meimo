const { execSync } = require('child_process');

console.log('=== PM2 out logs for CONSUME_8594 ===');
try {
  const out = execSync('grep CONSUME_8594 /home/ubuntu/.pm2/logs/repark-h5-out.log 2>&1');
  console.log(out.toString());
} catch(e) { console.log('NOT FOUND or error:', e.message); }

console.log('\n=== PM2 err logs for CONSUME_8594 ===');
try {
  const out = execSync('grep CONSUME_8594 /home/ubuntu/.pm2/logs/repark-h5-error.log 2>&1');
  console.log(out.toString());
} catch(e) { console.log('NOT FOUND or error:', e.message); }

console.log('\n=== Recent consume/user_action logs (last 50 lines) ===');
try {
  const out = execSync('tail -50 /home/ubuntu/.pm2/logs/repark-h5-out.log 2>&1 | grep -E "user_action|consume|CONSUME|alias|128|energy|daily" || echo "no matches"');
  console.log(out.toString());
} catch(e) { console.log(e.message); }

console.log('\n=== Recent all logs ===');
try {
  const out = execSync('tail -20 /home/ubuntu/.pm2/logs/repark-h5-out.log 2>&1');
  console.log(out.toString());
} catch(e) { console.log(e.message); }
