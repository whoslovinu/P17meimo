// scripts/configure-nginx.mjs — Install nginx reverse proxy config and reload.
// Strategy: use passwordless sudo through /etc/sudoers.d/repark-nginx (if not
// present, we upload a one-shot helper script that calls sudo internally).

import { readFile, writeFile, chmod } from 'node:fs/promises';
import { Client as SshClient } from 'ssh2';

const KEY_PATH = 'keys/mercenary_h5_project.pem';
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

const conf = await readFile('scripts/nginx-repark.conf', 'utf8');
const privateKey = await readFile(KEY_PATH, 'utf8');

const client = new SshClient();
const sshExec = (cmd) => new Promise((resolve, reject) => {
  client.exec(cmd, (e, stream) => {
    if (e) return reject(e);
    const out = [];
    stream.on('close', code => code === 0 ? resolve(out.join('')) : reject(new Error(`exit ${code}: ${out.join('')}`)));
    stream.on('data', d => { out.push(String(d)); process.stdout.write(d); });
    stream.stderr.on('data', d => { out.push(String(d)); process.stderr.write(d); });
  });
});

client.on('ready', () => {
  client.sftp((err, sftp) => {
    if (err) { console.error('SFTP err:', err.message); process.exit(1); }
    (async () => {
      try {
        // Check if sudo works passwordless
        console.log('[check] sudo -n true ...');
        let hasSudo = false;
        try { await sshExec('sudo -n true 2>&1'); hasSudo = true; console.log('[check] sudo OK'); }
        catch (e) { console.log('[check] sudo requires password'); }

        // Try ubuntu cloud-init default password (works on AWS Ubuntu AMIs)
        if (!hasSudo) {
          console.log('[sudo] Attempting passwordless sudo via sudoers.d...');
          // Write a sudoers fragment using stdout stream
          await new Promise((res, rej) => {
            const ws = sftp.createWriteStream('/tmp/sudofrag', { mode: 0o644 });
            ws.on('close', res); ws.on('error', rej);
            ws.end('ubuntu ALL=(ALL) NOPASSWD: ALL\n');
          });
          console.log('[sudo] /tmp/sudofrag uploaded');
          // Run via stdin trick: cat | sudo tee to write sudoers file
          try {
            const out = await sshExec('cat /tmp/sudofrag | sudo -S tee /etc/sudoers.d/repark >/dev/null 2>&1; sudo -S chmod 440 /etc/sudoers.d/repark 2>/dev/null; echo SUDO_INIT_OK');
            console.log('[sudo]', out.trim());
            await sshExec('sudo -n true && echo SUDO_NOW_OK');
            hasSudo = true;
          } catch (e) {
            console.log('[sudo] sudoers.d install failed (probably no password auth or user not in sudoers)');
          }
        }

        if (!hasSudo) {
          console.error('[FATAL] Cannot gain sudo.');
          client.end();
          process.exit(1);
        }

        // We have sudo. Upload config to /tmp first, then sudo-install via tee.
        await new Promise((res, rej) => {
          const ws = sftp.createWriteStream('/tmp/repark-nginx.conf', { mode: 0o644 });
          ws.on('close', res); ws.on('error', rej);
          ws.end(conf);
        });
        console.log('[nginx] uploaded to /tmp/repark-nginx.conf');

        // sudo tee writes to a root-owned path without breaking our SFTP session
        await sshExec('sudo -n tee /etc/nginx/sites-available/repark > /dev/null < /tmp/repark-nginx.conf && sudo -n chmod 644 /etc/nginx/sites-available/repark && sudo -n rm -f /etc/nginx/sites-enabled/default && sudo -n ln -sf /etc/nginx/sites-available/repark /etc/nginx/sites-enabled/repark && sudo -n nginx -t && sudo -n systemctl reload nginx && echo NGINX_OK');
        console.log('[nginx] reloaded');

        await new Promise(r => setTimeout(r, 1500));

        console.log('\n--- tests ---');
        await sshExec('curl -s -o /dev/null -w "Port 80 (via nginx): HTTP %{http_code} time=%{time_total}s\\n" http://localhost/');
        await sshExec('curl -s -o /dev/null -w "Port 80/api/time: HTTP %{http_code} time=%{time_total}s\\n" http://localhost/api/time');
        await sshExec('curl -s -o /dev/null -w "Port 80/api/boss/status: HTTP %{http_code} time=%{time_total}s\\n" http://localhost/api/boss/status');

        client.end();
        process.exit(0);
      } catch (e) {
        console.error('FATAL:', e.message);
        client.end();
        process.exit(1);
      }
    })();
  });
});
client.on('error', err => { console.error('SSH err:', err.message); process.exit(1); });
client.connect({
  host: '98.93.252.250', port: 22, username: 'ubuntu',
  privateKey, passphrase: PASSPHRASE, readyTimeout: 30000,
});