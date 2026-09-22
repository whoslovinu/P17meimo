import http from 'node:http';

function req(method, path, body, auth) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { 'Authorization': `Bearer ${auth}` } : {}),
      },
    };
    const r = http.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  // Test user status endpoint
  console.log('=== Test user_status with uuid ===');
  const u1 = await req('GET', '/api/user/status', null, '00000000-0000-0000-0000-000000000000');
  console.log('uuid=00000000:', JSON.stringify(u1.body));

  const u2 = await req('GET', '/api/user/status', null, '2747b7c7-1856-5ba5-b066-f0523b03e17f');
  console.log('uuid=2747b7c7:', JSON.stringify(u2.body));

  const u3 = await req('GET', '/api/user/status', null, '128');
  console.log('user_id=128:', JSON.stringify(u3.body));

  // Check PM2 logs for CONSUME_8594
  const { execSync } = require('child_process');
  console.log('\n=== PM2 logs for CONSUME_8594 ===');
  try {
    const out = execSync('grep CONSUME_8594 /home/ubuntu/.pm2/logs/repark-h5-out.log 2>&1 || echo "NOT FOUND"');
    console.log(out.toString());
  } catch(e) { console.log('grep failed:', e.message); }

  console.log('\n=== Recent user_action webhook logs ===');
  try {
    const out = execSync('tail -30 /home/ubuntu/.pm2/logs/repark-h5-out.log 2>&1 | grep -E "user_action|consume|CONSUME|alias|UUID|128" || echo "no matches"');
    console.log(out.toString());
  } catch(e) { console.log(e.message); }
}

main().catch(console.error);
