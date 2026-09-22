// scripts/pm2-start.mjs — Run pm2 start/restart on the server.
// Usage:
//   node scripts/pm2-start.mjs start
//   node scripts/pm2-start.mjs restart
//   node scripts/pm2-start.mjs status
//   node scripts/pm2-start.mjs logs 100
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

const action = process.argv[2] || 'status';
const extra = process.argv[3] || '';

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

const COMMANDS = {
  start: `cd /var/www/app && pm2 start ecosystem.config.js --env production && pm2 save`,
  restart: `cd /var/www/app && pm2 start ecosystem.config.js --env production && pm2 save`,
  reload: `cd /var/www/app && pm2 reload ecosystem.config.js --env production && pm2 save`,
  stop: `pm2 stop repark-h5`,
  status: `pm2 status`,
  logs: `pm2 logs repark-h5 --lines ${parseInt(extra, 10) || 50} --nostream --raw`,
};

const cmd = COMMANDS[action];
if (!cmd) { console.error(`Unknown action: ${action}. Use: ${Object.keys(COMMANDS).join(', ')}`); process.exit(2); }

const privateKey = await readFile(KEY_PATH, 'utf8');
const client = new SshClient();

client.on('ready', () => {
  log('SSH', `Action=${action}`);
  client.exec(cmd, (e, stream) => {
    if (e) { console.error('exec err:', e.message); process.exit(1); }
    stream.on('close', (code) => {
      log('EXEC', `done code=${code}`);
      client.end();
      process.exit(code ?? 0);
    });
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
  });
});

client.on('error', err => { console.error('SSH err:', err.message); process.exit(1); });
client.connect({
  host: BASTION_HOST, port: BASTION_PORT, username: BASTION_USERNAME,
  privateKey, passphrase: PASSPHRASE, readyTimeout: 30000,
});