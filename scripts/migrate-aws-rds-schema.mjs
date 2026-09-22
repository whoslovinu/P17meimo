import { createServer } from 'node:net';
import { readFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { Client as SshClient } from 'ssh2';

const { Client } = pg;

const SQL_FILES = [
  'aws_01_schema.sql',
  'aws_02_indexes.sql',
  'aws_03_functions.sql',
  'aws_04_seed.sql',
];

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const RDS_HOST = 'rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com';
const RDS_PORT = 5432;
const LOCAL_FORWARD_HOST = '127.0.0.1';
const LOCAL_FORWARD_PORT = 5433;
const DATABASE_NAME = 'postgres';
const DATABASE_USER = 'postgres';
const DATABASE_PASSWORD = 'PhbcRcx5Wt';
const KEY_COMMENT = 'mercenary_h5_project';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const sqlDirectory = path.join(projectRoot, 'aws_rds_init');
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

function buildDatabaseConnectionString() {
  return `postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@${LOCAL_FORWARD_HOST}:${LOCAL_FORWARD_PORT}/${DATABASE_NAME}`;
}

function connectSsh(privateKey, passphrase) {
  return new Promise((resolve, reject) => {
    const sshClient = new SshClient();

    sshClient
      .on('ready', () => resolve(sshClient))
      .on('error', (error) => reject(error))
      .connect({
        host: BASTION_HOST,
        port: BASTION_PORT,
        username: BASTION_USERNAME,
        privateKey,
        passphrase,
      });
  });
}

function startTunnelServer(sshClient) {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      sshClient.forwardOut(
        socket.remoteAddress || LOCAL_FORWARD_HOST,
        socket.remotePort || 0,
        RDS_HOST,
        RDS_PORT,
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

    server.once('error', (error) => reject(error));
    server.listen(LOCAL_FORWARD_PORT, LOCAL_FORWARD_HOST, () => resolve(server));
  });
}

function closeServer(server) {
  if (!server) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function run() {
  let sshClient = null;
  let tunnelServer = null;
  let pgClient = null;

  try {
    console.log('[DEPLOY_SCRIPT_LOG] Starting AWS RDS deployment over SSH tunnel');
    console.log(`[DEPLOY_SCRIPT_LOG] SQL directory: ${sqlDirectory}`);

    const privateKeyPath = await resolvePrivateKeyPath();
    const privateKey = await readFile(privateKeyPath, 'utf8');
    const privateKeyPassphrase = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;
    console.log(`[DEPLOY_SCRIPT_LOG] Using SSH key: ${privateKeyPath}`);

    sshClient = await connectSsh(privateKey, privateKeyPassphrase);
    console.log('[DEPLOY_SCRIPT_LOG] SSH connection established');

    tunnelServer = await startTunnelServer(sshClient);
    console.log(
      `[DEPLOY_SCRIPT_LOG] Tunnel ready: ${LOCAL_FORWARD_HOST}:${LOCAL_FORWARD_PORT} -> ${RDS_HOST}:${RDS_PORT}`,
    );

    pgClient = new Client({
      connectionString: buildDatabaseConnectionString(),
      ssl: { rejectUnauthorized: false },
    });

    await pgClient.connect();
    console.log('[DEPLOY_SCRIPT_LOG] Connected to AWS RDS through SSH tunnel');

    for (const fileName of SQL_FILES) {
      const filePath = path.join(sqlDirectory, fileName);
      console.log(`[DEPLOY_SCRIPT_LOG] Running ${fileName}...`);

      try {
        const sql = await readFile(filePath, 'utf8');
        await pgClient.query(sql);
        console.log(`[DEPLOY_SCRIPT_LOG] SUCCESS ${fileName}`);
      } catch (error) {
        console.error(`[DEPLOY_SCRIPT_LOG] FAILURE ${fileName}`);
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
        return;
      }
    }

    console.log('[DEPLOY_SCRIPT_LOG] All SQL files executed successfully through SSH tunnel');
    process.exitCode = 0;
  } catch (error) {
    console.error('[DEPLOY_SCRIPT_LOG] Deployment failed before completion');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    if (pgClient) {
      try {
        await pgClient.end();
        console.log('[DEPLOY_SCRIPT_LOG] Database connection closed');
      } catch (error) {
        console.error('[DEPLOY_SCRIPT_LOG] Failed to close database connection cleanly');
        console.error(error instanceof Error ? error.message : error);
      }
    }

    if (tunnelServer) {
      try {
        await closeServer(tunnelServer);
        console.log('[DEPLOY_SCRIPT_LOG] SSH tunnel closed');
      } catch (error) {
        console.error('[DEPLOY_SCRIPT_LOG] Failed to close SSH tunnel cleanly');
        console.error(error instanceof Error ? error.message : error);
      }
    }

    if (sshClient) {
      try {
        sshClient.end();
        console.log('[DEPLOY_SCRIPT_LOG] SSH connection closed');
      } catch (error) {
        console.error('[DEPLOY_SCRIPT_LOG] Failed to close SSH connection cleanly');
        console.error(error instanceof Error ? error.message : error);
      }
    }
  }
}

await run();
