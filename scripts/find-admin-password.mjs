/**
 * Debug admin login cookie extraction.
 */
import { readFileSync } from 'fs';
import { Client } from 'ssh2';

const SSH = { host: '98.93.252.250', port: 22, username: 'ubuntu', keyPath: './keys/mercenary_h5_project.pem' };

async function execSsh(conn, cmd, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('SSH timeout')), timeoutMs);
    conn.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(t); reject(err); return; }
      let out = '', err2 = '';
      stream.on('data', d => { out += d; });
      stream.stderr.on('data', d => { err2 += d; });
      stream.on('close', () => { clearTimeout(t); resolve({ out: out.trim(), err: err2.trim() }); });
    });
  });
}

async function main() {
  const key = readFileSync(SSH.keyPath);
  const conn = new Client();

  await new Promise((res, rej) => {
    conn.on('ready', async () => {
      try {
        // Try login and show ALL response headers
        const r1 = await execSsh(conn,
          `curl -s -X POST http://localhost:3000/api/admin/login \
           -H "Content-Type: application/json" \
           -d '{"password":"giys-agjj-niqt-yx2g"}' \
           -D /tmp/h1.txt \
           -c /tmp/c1.txt 2>&1`
        );
        console.log('=== LOGIN RESPONSE ===');
        console.log(r1.out);
        console.log('\n=== HEADERS ===');
        const headers = await execSsh(conn, 'cat /tmp/h1.txt');
        console.log(headers.out);
        console.log('\n=== COOKIE FILE ===');
        const ck = await execSsh(conn, 'cat /tmp/c1.txt');
        console.log(ck.out);
        console.log('\n=== COOKIE FILE (raw) ===');
        const ckRaw = await execSsh(conn, "cat /tmp/c1.txt | od -c | head -20");
        console.log(ckRaw.out);

        conn.end();
        res();
      } catch (e) {
        conn.end();
        rej(e);
      }
    });
    conn.on('error', e => { console.error('[SSH]', e.message); rej(e); });
    conn.connect({ host: SSH.host, port: SSH.port, username: SSH.username, privateKey: key, readyTimeout: 15000 });
  });
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
