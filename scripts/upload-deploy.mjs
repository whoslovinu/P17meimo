// scripts/upload-deploy.mjs — Stream local build to server via SSH2
// Uses the same ssh2 library as remote-shell.mjs
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Client } from 'ssh2';

const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const HOST = '98.93.252.250';
const USER = 'ubuntu';
const LOCAL_DIR = path.resolve('.');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');

  // Use tar to stream to server stdin, which untars it
  const { spawn } = await import('node:child_process');
  const tar = spawn('tar', [
    'czf', '-',
    '-C', LOCAL_DIR,
    '.next',
    'package.json',
    'ecosystem.config.js',
  ], { stdio: ['ignore', 'pipe', 'inherit'] });

  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      console.log('[SSH] Connected. Streaming build...');
      const remoteDir = `/tmp/deploy-${TIMESTAMP}`;
      const cmd = `mkdir -p ${remoteDir} && tar -xzf - -C ${remoteDir} && echo DEPLOY_STREAM_OK && ls ${remoteDir}/.next/BUILD_ID`;
      conn.exec(cmd, { pty: false }, (err, stream) => {
        if (err) { reject(err); return; }
        tar.stdout.pipe(stream.stdin);
        stream.on('data', (data) => process.stdout.write(data.toString()));
        stream.stderr.on('data', (data) => process.stderr.write(data.toString()));
        stream.on('close', (code) => {
          if (code === 0) {
            console.log(`[OK] Build streamed to ${remoteDir}`);
          } else {
            console.error(`[ERROR] Stream exited with code ${code}`);
          }
          conn.end();
          resolve(code === 0 ? 0 : code);
        });
      });
    });
    conn.on('error', (err) => { console.error('SSH error:', err.message); reject(err); });
    conn.connect({ host: HOST, port: 22, username: USER, privateKey, readyTimeout: 30000 });
  });
}

main().then(code => process.exit(code ?? 0)).catch(e => { console.error('FATAL:', e.message); process.exit(1); });
