// scripts/tunnel-battle.mjs — TCP server that forwards to bastion:3000 via SSH
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';
import { Client as SshClient } from 'ssh2';

const HOST = '98.93.252.250';
const USER = 'ubuntu';
const LOCAL_PORT = 3300;
const REMOTE_HOST = '127.0.0.1';
const REMOTE_PORT = 3000;
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

const privateKey = await readFile(KEY_PATH, 'utf8');
const client = new SshClient();

client.on('ready', () => {
  console.log(`[TUNNEL] SSH ready. Bringing up local TCP on 127.0.0.1:${LOCAL_PORT}`);
  const server = createServer((local) => {
    console.log(`[TUNNEL] local conn from ${local.remoteAddress}:${local.remotePort}`);
    client.forwardOut('127.0.0.1', LOCAL_PORT, REMOTE_HOST, REMOTE_PORT, (err, stream) => {
      if (err) {
        console.error('[TUNNEL] forwardOut err:', err.message);
        local.destroy();
        return;
      }
      local.pipe(stream);
      stream.pipe(local);
      stream.on('close', () => local.destroy());
      local.on('close', () => stream.close());
    });
  });
  server.listen(LOCAL_PORT, '127.0.0.1', () => {
    console.log(`[TUNNEL] Listening on http://127.0.0.1:${LOCAL_PORT} → ${HOST}:${REMOTE_PORT} (via ${REMOTE_HOST})`);
  });
});

client.on('error', err => { console.error('[TUNNEL] SSH err:', err.message); process.exit(1); });
client.connect({
  host: HOST, port: 22, username: USER,
  privateKey, passphrase: PASSPHRASE, readyTimeout: 30000,
});

setInterval(() => {}, 1 << 30);