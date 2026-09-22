// Hit the live webhook with the customer's exact payload and see the real response.
const path = require('path');
const fs = require('fs');
const { Client: SshClient } = require('ssh2');

const LOCAL_KEY = path.resolve('keys/mercenary_h5_project.pem');

async function sshExec(client, cmd, label) {
  return new Promise((resolve, reject) => {
    console.log(`[${label}] $ ${cmd}`);
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('data', d => { out += d; process.stdout.write(d); });
      stream.stderr.on('data', d => process.stderr.write(d));
      stream.on('close', code => resolve({ code, out }));
    });
  });
}

(async () => {
  const pk = await fs.promises.readFile(LOCAL_KEY, 'utf8');
  const c = new SshClient();
  c.on('ready', async () => {
    try {
      // Step 1: read pm2 log tail to see what really happened
      console.log('\n=== pm2 error log tail ===');
      await sshExec(c, 'tail -30 /var/log/repark-h5/error-0.log 2>/dev/null || echo "no err log"', 'errlog');

      console.log('\n=== pm2 out log tail (last 20) ===');
      await sshExec(c, 'tail -20 /var/log/repark-h5/out-0.log 2>/dev/null || echo "no out log"', 'outlog');

      // Step 2: simulate the EXACT customer call from server-side
      console.log('\n=== curl webhook with exact customer payload ===');
      // customer payload from earlier chat (incomplete — must reconstruct)
      // user_id was 1 (number), tx_id was TEST_CONSUME_1784727327618, sign was 0x32
      const customerPayload = JSON.stringify({
        action_type: 'consume',
        amount: 100,
        sign: '0'.repeat(64),
        timestamp: Date.now(),
        tx_id: 'PROBE_' + Date.now(),
        user_id: 1
      });
      const curlCmd = [
        'curl -s -w "\\nHTTP=%{http_code} TIME=%{time_total}\\n"',
        '-X POST http://localhost:3000/api/webhook/user-action',
        '-H "Content-Type: application/json"',
        '-H "X-Webhook-Signature: sha256=0000000000000000000000000000000000000000000000000000000000000000"',
        '-H "X-Request-id: PROBE_' + Date.now() + '"',
        `--data '${customerPayload}'`,
      ].join(' ');
      const probe = await sshExec(c, curlCmd, 'probe');
      console.log(`\nProbe HTTP exit code: ${probe.code}`);

      // Step 3: try with valid HMAC to isolate issue
      console.log('\n=== curl webhook with VALID HMAC (to bypass auth) ===');
      const secret = (await sshExec(c, 'grep WEBHOOK_SECRET /var/www/app/.env.production | cut -d= -f2', 'getsecret')).out.trim();
      const bodyStr = customerPayload;
      const cryptoCmd = `node -e "const c=require('crypto');const b='${bodyStr.replace(/'/g, "'\\''")}';const s='${secret}';console.log(c.createHmac('sha256',s).update(b).digest('hex'));"`;
      const hmac = (await sshExec(c, cryptoCmd, 'hmac')).out.trim();
      console.log('HMAC computed:', hmac);
      const validProbeCmd = [
        'curl -s -w "\\nHTTP=%{http_code} TIME=%{time_total}\\n"',
        '-X POST http://localhost:3000/api/webhook/user-action',
        '-H "Content-Type: application/json"',
        `-H "X-Webhook-Signature: sha256=${hmac}"`,
        `--data '${customerPayload}'`,
      ].join(' ');
      await sshExec(c, validProbeCmd, 'valid-probe');

      c.end();
      process.exit(0);
    } catch (err) {
      console.error('FAIL:', err.message);
      c.end();
      process.exit(1);
    }
  });
  c.on('error', e => { console.error(e); process.exit(1); });
  c.connect({ host: '98.93.252.250', port: 22, username: 'ubuntu', privateKey: pk, readyTimeout: 30000 });
})();