// Compare server code vs local code.
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
      stream.on('data', d => process.stdout.write(d));
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
      // 1) Server code — full route.ts + relevant pg.ts slice
      console.log('\n=== server route.ts (full, 230 lines) ===');
      await sshExec(c, 'cat -n /var/www/app/app/api/webhook/user-action/route.ts', 'route-full');

      console.log('\n=== server .next build manifest — what was actually compiled ===');
      await sshExec(c, 'cat /var/www/app/.next/BUILD_ID && echo "---" && ls -la /var/www/app/.next/server/app/api/webhook/user-action/ 2>&1 | head -20', 'buildid');

      console.log('\n=== server WEBHOOK_SECRET (decoded) ===');
      const sec = (await sshExec(c, 'grep WEBHOOK_SECRET /var/www/app/.env.production', 'sec1')).out.trim();
      console.log(sec);

      // 2) Re-test with **server-side HMAC computation** using the EXACT bytes
      //    the server reads from req.text() — this is the canary.
      console.log('\n=== server-side HMAC computation & probe ===');
      const probeBody = '{"action_type":"consume","amount":100,"sign":"0000000000000000000000000000000000000000000000000000000000000000","timestamp":1784773560924,"tx_id":"PROBE_CANARY_1784773560924","user_id":1}';
      const canaryCmd = `node -e "
const http = require('http');
const c = require('crypto');
const body = ${JSON.stringify(probeBody)};
const sec = process.env.WEBHOOK_SECRET || (() => { const fs = require('fs'); const env = fs.readFileSync('/var/www/app/.env.production', 'utf8').split('\\n').find(l => l.startsWith('WEBHOOK_SECRET=')).split('=')[1]; return env; })();
const hmac = c.createHmac('sha256', sec).update(body, 'utf8').digest('hex');
const req = http.request({
  hostname: 'localhost', port: 3000, path: '/api/webhook/user-action',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': 'sha256=' + hmac, 'Content-Length': Buffer.byteLength(body) }
}, (res) => {
  let buf = '';
  res.on('data', d => buf += d);
  res.on('end', () => {
    console.log('HTTP=' + res.statusCode);
    console.log('BODY=' + buf);
    console.log('USED_SECRET=' + sec.slice(0, 16) + '...');
    console.log('USED_HMAC=' + hmac);
  });
});
req.write(body); req.end();
"`;
      await sshExec(c, canaryCmd, 'canary');

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