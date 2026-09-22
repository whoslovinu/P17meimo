const c = require('crypto');
const { Client: SshClient } = require('ssh2');
const path = require('path');
const fs = require('fs');

const body = JSON.stringify({
  user_id: 'test_user_002',
  action_type: 'consume',
  amount: 50,
  tx_id: 'tx_repro_002_long_id_xyz',
  timestamp: 1753200001000,
  sign: '0'.repeat(64),
});
const secret = 'a522d951a734d461d2ee783de68dc5732eeb24c61966ce9c736225af1a3a7506';
const sig = 'sha256=' + c.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

const script = `#!/bin/bash
echo "BODY=${body}"
echo "SIG=${sig}"
echo "---"
curl -s -i -X POST 'http://98.93.252.250/api/webhook/user-action' \\
  -H 'Content-Type: application/json' \\
  -H "X-Webhook-Signature: ${sig}" \\
  --data '${body}'
echo ""
`;

const main = async () => {
  const pk = await fs.promises.readFile(path.resolve('keys/mercenary_h5_project.pem'), 'utf8');
  const c2 = new SshClient();
  c2.on('ready', () => {
    c2.sftp((err, sftp) => {
      if (err) throw err;
      const ws = sftp.createWriteStream('/tmp/repro.sh');
      ws.on('close', () => {
        c2.exec('chmod +x /tmp/repro.sh && bash /tmp/repro.sh 2>&1', (e, stream) => {
          if (e) throw e;
          stream.on('data', d => process.stdout.write(d));
          stream.stderr.on('data', d => process.stderr.write(d));
          stream.on('close', (code) => { c2.end(); process.exit(code ?? 0); });
        });
      });
      ws.end(script);
    });
  });
  c2.on('error', e => { console.error(e); process.exit(1); });
  c2.connect({ host: '98.93.252.250', port: 22, username: 'ubuntu', privateKey: pk, readyTimeout: 30000 });
};
main();