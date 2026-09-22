import { createServer } from 'node:net';
import { readFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'node:url';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';

const RDS_HOST = 'rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com';
const RDS_PORT = 5432;
const LOCAL_RDS_PORT = 5433;

const REDIS_HOST = 'rp1-bkmbmc.serverless.use1.cache.amazonaws.com';
const REDIS_PORT = 6379;
const LOCAL_REDIS_PORT = 6380;

const LOCAL_FORWARD_HOST = '127.0.0.1';
const KEY_COMMENT = 'mercenary_h5_project';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const defaultKeyDirectory = path.join(projectRoot, 'keys');

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getCandidateKeyPaths() {
  const envPath = process.env.DEPLOY_SSH_KEY_PATH ? process.env.DEPLOY_SSH_KEY_PATH.trim() : '';
  const homeDirectory = os.homedir();

  const candidates = [
    envPath,
    path.join(defaultKeyDirectory, KEY_COMMENT),
    path.join(defaultKeyDirectory, `${KEY_COMMENT}.pem`),
    path.join(projectRoot, '.ssh', KEY_COMMENT),
    path.join(projectRoot, '.ssh', `${KEY_COMMENT}.pem`),
    path.join(homeDirectory, '.ssh', KEY_COMMENT),
    path.join(homeDirectory, '.ssh', `${KEY_COMMENT}.pem`),
    path.join(homeDirectory, '.ssh', 'id_ed25519'),
    path.join(homeDirectory, '.ssh', 'id_rsa'),
  ].filter(Boolean);

  return [...new Set(candidates)];
}

async function resolvePrivateKeyPath() {
  const candidatePaths = getCandidateKeyPaths();

  for (const candidatePath of candidatePaths) {
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  const fallbackPath = path.join(defaultKeyDirectory, `${KEY_COMMENT}.pem`);
  throw new Error(
    [
      `SSH private key not found for ${KEY_COMMENT}.`,
      'Set DEPLOY_SSH_KEY_PATH to your private key, or place the key at one of these paths:',
      ...candidatePaths.map((candidatePath) => `- ${candidatePath}`),
      `Recommended fallback path: ${fallbackPath}`,
    ].join('\n'),
  );
}

function buildTunnelServer(remoteHost, remotePort, localPort) {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      sshClient.forwardOut(
        socket.remoteAddress || LOCAL_FORWARD_HOST,
        socket.remotePort || 0,
        remoteHost,
        remotePort,
        (error, stream) => {
          if (error) {
            socket.destroy(error);
            return;
          }
          socket.pipe(stream);
          stream.pipe(socket);
        },
      );
    });

    server.on('error', (error) => reject(error));
    server.listen(localPort, LOCAL_FORWARD_HOST, () => resolve(server));
  });
}

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let sshClient = null;
let rdsServer = null;
let redisServer = null;
let reconnectTimer = null;
let shuttingDown = false;

async function connect() {
  const privateKeyPath = await resolvePrivateKeyPath();
  const privateKey = await readFile(privateKeyPath, 'utf8');
  const passphrase = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

  log('TUNNEL', `Using SSH key: ${privateKeyPath}`);

  return new Promise((resolve, reject) => {
    const client = new SshClient();
    let resolved = false;

    const safeReject = (err) => {
      if (resolved) return;
      resolved = true;
      try { client.end(); } catch { /* swallow */ }
      reject(err);
    };

    client.on('ready', () => {
      if (resolved) return;
      resolved = true;
      log('SSH', 'Connected to bastion');
      resolve(client);
    });

    // CRITICAL: swallow ALL errors. The underlying TCP socket can emit 'error'
    // AFTER client.end() / close — without this handler, Node.js throws an
    // "unhandled 'error' event" and crashes the whole process. We never want
    // a transient network blip to take down our tunnel.
    client.on('error', (err) => {
      log('SSH', `Error: ${err.message}`);
      safeReject(err);
    });

    let reconnectAttempt = 0;
    client.on('close', () => {
      if (shuttingDown) return;
      reconnectAttempt += 1;
      // Exponential backoff: 5s, 10s, 20s, 40s, capped at 60s.
      const delay = Math.min(5_000 * Math.pow(2, reconnectAttempt - 1), 60_000);
      log('SSH', `Connection closed — reconnecting in ${delay / 1000}s (attempt ${reconnectAttempt})...`);
      reconnectTimer = setTimeout(() => {
        if (shuttingDown) return;
        connect()
          .then(startTunnels)
          .then(() => {
            reconnectAttempt = 0;
          })
          .catch((reconnectErr) => {
            log('SSH', `Reconnect attempt ${reconnectAttempt} failed: ${reconnectErr.message}`);
            // schedule another retry via the close handler of the new client
          });
      }, delay);
    });

    client.on('end', () => {
      log('SSH', 'Connection ended.');
    });

    // Belt-and-braces: attach error listener to the underlying TCP socket
    // as well. ssh2 sometimes emits socket-level errors before client-level
    // errors propagate.
    client.on('tcpConnection', (tcp) => {
      tcp.on('error', (err) => {
        log('TCP', `Socket error: ${err.message}`);
      });
    });

    client.connect({
      host: BASTION_HOST,
      port: BASTION_PORT,
      username: BASTION_USERNAME,
      privateKey,
      passphrase,
      keepaliveInterval: 30000,   // send keepalive every 30s
      keepaliveCountMax: 10,      // tolerate 10 missed keepalives (5 min)
      readyTimeout: 20000,
    });
  });
}

async function startTunnels(client) {
  sshClient = client;

  rdsServer = await buildTunnelServer(RDS_HOST, RDS_PORT, LOCAL_RDS_PORT);
  log('TUNNEL', `RDS  localhost:${LOCAL_RDS_PORT} -> ${RDS_HOST}:${RDS_PORT} [ACTIVE]`);

  redisServer = await buildTunnelServer(REDIS_HOST, REDIS_PORT, LOCAL_REDIS_PORT);
  log('TUNNEL', `Redis localhost:${LOCAL_REDIS_PORT} -> ${REDIS_HOST}:${REDIS_PORT} [ACTIVE]`);

  log('READY', '================================================================');
  log('READY', 'SSH Tunnel Active! Keep this terminal open and run Next.js in another terminal.');
  log('READY', '  DATABASE_URL="postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres"');
  log('READY', '  REDIS_URL="rediss://127.0.0.1:6380"');
  log('READY', '================================================================');

  console.log('\n[DEV_TUNNEL_READY]');
}

async function shutdown() {
  shuttingDown = true;
  log('SHUTDOWN', 'Closing tunnels...');

  if (reconnectTimer) clearTimeout(reconnectTimer);

  const closePromises = [];
  if (rdsServer) closePromises.push(new Promise((r) => rdsServer.close(r)));
  if (redisServer) closePromises.push(new Promise((r) => redisServer.close(r)));
  if (sshClient) closePromises.push(new Promise((r) => { sshClient.end(); r(); }));

  await Promise.allSettled(closePromises);
  log('SHUTDOWN', 'Done. Bye.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Last-resort safety net: never let a stray exception kill the tunnel.
// We log it and let the reconnect handler take over.
process.on('uncaughtException', (err) => {
  log('FATAL', `uncaughtException: ${err.message}`);
  log('FATAL', 'Stack:', err.stack || '(no stack)');
  // Do NOT exit — let the SSH client's 'close' handler reconnect.
});

process.on('unhandledRejection', (reason) => {
  log('FATAL', `unhandledRejection: ${reason}`);
});

async function main() {
  try {
    sshClient = await connect();
    await startTunnels(sshClient);
  } catch (err) {
    log('ERROR', `Failed to connect: ${err.message}`);
    log('ERROR', 'Check your SSH key, passphrase, and bastion host connectivity.');
    process.exit(1);
  }
}

main();
