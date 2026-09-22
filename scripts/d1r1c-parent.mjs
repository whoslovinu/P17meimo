// scripts/d1r1c-parent.mjs — Investigate parent process and restart strategy
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');

function log(label, msg) { console.log(`[${label}] ${msg}`); }

async function sshExec(client, cmd) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) { reject(err); return; }
      let out = '', err2 = '';
      stream.on('data', d => out += d);
      stream.stderr.on('data', d => err2 += d);
      stream.on('close', () => resolve({ out, err: err2 }));
    });
  });
}

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  const client = new SshClient();
  await new Promise((resolve, reject) => {
    client.on('ready', resolve);
    client.on('error', reject);
    client.connect({ host: BASTION_HOST, port: BASTION_PORT, username: BASTION_USERNAME, privateKey, readyTimeout: 30000 });
  });
  log('SSH', 'Connected');

  const parentPid = 885163;

  // Parent process info
  log('PARENT', 'parent cmdline:');
  const cmdline = await sshExec(client, `cat /proc/${parentPid}/cmdline | tr "\\0" " "`);
  log('PARENT', cmdline.out.trim());

  log('PARENT', 'parent ps:');
  const ps = await sshExec(client, `ps aux | grep ${parentPid} | grep -v grep`);
  log('PARENT', ps.out.trim());

  log('PARENT', 'parent parent:');
  const ppid = await sshExec(client, `cat /proc/${parentPid}/status | grep PPid`);
  log('PARENT', ppid.out.trim());

  // Check grandparent
  const ppidVal = ppid.out.match(/\d+/)?.[0];
  if (ppidVal) {
    log('GPARENT', 'grandparent cmdline:');
    const gpCmdline = await sshExec(client, `cat /proc/${ppidVal}/cmdline | tr "\\0" " "`);
    log('GPARENT', gpCmdline.out.trim());
    log('GPARENT', 'grandparent ps:');
    const gpPs = await sshExec(client, `ps aux | grep ${ppidVal} | grep -v grep`);
    log('GPARENT', gpPs.out.trim());
  }

  // Check for startup scripts in /var/www/app
  log('APP', 'start scripts in /var/www/app:');
  const ls = await sshExec(client, 'ls -la /var/www/app/start*.sh /var/www/app/run*.sh /var/www/app/next*.sh 2>/dev/null || echo "none found"');
  log('APP', ls.out.trim());

  // Check for ecosystem.config.js
  log('APP', 'ecosystem config:');
  const eco = await sshExec(client, 'cat /var/www/app/ecosystem.config.js 2>/dev/null || echo "not found"');
  log('APP', eco.out.slice(0, 500));

  // Check /etc/supervisor
  log('SUP', 'supervisor dir:');
  const supDir = await sshExec(client, 'ls /etc/supervisor/conf.d/ 2>/dev/null || echo "no supervisor"');
  log('SUP', supDir.out.trim());
  const supConf = await sshExec(client, 'cat /etc/supervisor/conf.d/*.conf 2>/dev/null || echo "no conf"');
  log('SUP', supConf.out.trim());

  // Check /etc/systemd
  log('SYS', 'systemd service:');
  const sysd = await sshExec(client, 'ls /etc/systemd/system/*.service 2>/dev/null | grep -i repark; cat /etc/systemd/system/repark* 2>/dev/null || echo "no systemd"');
  log('SYS', sysd.out.slice(0, 500));

  // Check the actual way the next-server was invoked - look at /proc/pid/environ
  log('ENV', 'next-server environ (sample):');
  const env = await sshExec(client, 'cat /proc/1010855/environ | tr "\\0" "\\n" | grep -v "^$" | head -30');
  log('ENV', env.out.trim());

  // What process killed/replaced the old build
  // Check if there's a "start" script that uses pm2 or directly starts node
  log('SCRIPTS', 'looking for start scripts:');
  const startScripts = await sshExec(client, 'find /var/www/app -maxdepth 2 -name "*.sh" -o -name "ecosystem*" 2>/dev/null');
  log('SCRIPTS', startScripts.out.trim());

  client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(9); });
