// scripts/d1r1c-restart-next.mjs — Find and restart next-server with new build
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

  // Find PID of next-server dynamically
  log('FIND', 'Finding next-server PID:');
  const findPid = await sshExec(client, "ps aux | grep 'next-server' | grep -v grep | awk '{print \$2, \$3, \$4, \$11, \$12}'");
  log('FIND', findPid.out.trim());

  const pidLine = findPid.out.trim().split('\n')[0];
  const pid = pidLine ? pidLine.split(' ')[0] : null;
  log('FIND', `PID: ${pid}`);

  if (!pid) { log('ERROR', 'Cannot find next-server PID'); client.end(); process.exit(1); }

  // Get cmdline
  log('PROC', 'cmdline:');
  const cmdline = await sshExec(client, `cat /proc/${pid}/cmdline | tr "\\0" " "`);
  log('PROC', cmdline.out.trim());

  // Get cwd
  log('PROC', 'cwd:');
  const cwd = await sshExec(client, `readlink /proc/${pid}/cwd`);
  log('PROC', cwd.out.trim());

  // Get exe
  log('PROC', 'exe:');
  const exe = await sshExec(client, `readlink /proc/${pid}/exe`);
  log('PROC', exe.out.trim());

  // Get parent
  log('PROC', 'parent:');
  const parent = await sshExec(client, `cat /proc/${pid}/status | grep PPid`);
  log('PROC', parent.out.trim());

  // Check supervisor
  log('PROC', 'supervisor conf:');
  const sup = await sshExec(client, 'cat /etc/supervisor/conf.d/*.conf 2>/dev/null | head -40 || ls /etc/supervisor/conf.d/ 2>/dev/null || echo "no supervisor"');
  log('PROC', sup.out.trim());

  // Check how the process was started - look at /proc/pid/fd
  log('PROC', 'fd info (start of cmdline):');
  const fd = await sshExec(client, `ls -la /proc/${pid}/fd/ 2>/dev/null | head -10`);
  log('PROC', fd.out.trim());

  client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(9); });
