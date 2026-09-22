const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const outFile = fs.openSync('build_log.txt', 'w');
const errFile = fs.openSync('build_err_log.txt', 'w');

const child = spawn('node', ['node_modules/next/dist/bin/next', 'build'], {
  cwd: process.cwd(),
  stdio: ['ignore', outFile, errFile],
  env: { ...process.env, NODE_OPTIONS: '' }
});

console.log(`Build started with PID: ${child.pid}`);

let logLines = 0;
const logCheck = setInterval(() => {
  try {
    const content = fs.readFileSync('build_log.txt', 'utf8');
    const lines = content.split('\n').filter(l => l.trim()).length;
    if (lines === logLines) {
      console.log(`[STALL] No progress: ${lines} lines`);
    } else {
      console.log(`[PROGRESS] Lines: ${lines} (was ${logLines})`);
      logLines = lines;
    }
  } catch (e) { console.log(`[CHECK] ${e.message}`); }
}, 30000);

child.on('exit', (code) => {
  clearInterval(logCheck);
  console.log(`Build exited with code: ${code}`);
  fs.closeSync(outFile);
  fs.closeSync(errFile);
  process.exit(code);
});

child.on('error', (err) => {
  clearInterval(logCheck);
  console.error('Build error:', err);
  fs.closeSync(outFile);
  fs.closeSync(errFile);
  process.exit(1);
});

setTimeout(() => {
  console.log('Timeout reached, killing build');
  child.kill();
  process.exit(124);
}, 30 * 60 * 1000);
