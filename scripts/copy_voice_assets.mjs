/**
 * scripts/copy_voice_assets.mjs
 *
 * One-shot script that maps the raw voice clips under
 *   H5 000/H501/voice/stage{1..4}/
 * into the runtime naming convention AudioManager.playVoice expects:
 *   public/voice/Voice_{1..4}/Standby_1.mp3
 *   public/voice/Voice_{1..4}/ATKa_1.mp3
 *   public/voice/Voice_{1..4}/ATKb_1.mp3
 *
 * Selection rule: for each (stage, action) tuple, pick the largest of the
 * three candidate files — larger MP3s are usually higher bitrate / less
 * compressed. The other two are copied as `_2` / `_3` so future
 * enhancements can random-pick without re-running this script.
 *
 * Idempotent: re-running overwrites the destination files.
 *
 * Usage:
 *   node scripts/copy_voice_assets.mjs
 *   node scripts/copy_voice_assets.mjs --dry      # print mapping only
 */

import { readdirSync, copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE_ROOT = join(ROOT, 'H5 000', 'H501', 'voice');
const TARGET_ROOT = join(ROOT, 'public', 'voice');

const isDry = process.argv.includes('--dry');

// Pattern → action key. Matched case-insensitively, anchored on file stem.
const ACTION_PATTERNS = [
  { regex: /^standby.*\.mp3$/i,   action: 'standby' },
  { regex: /^attack_a.*\.mp3$/i,  action: 'attack_a' },
  { regex: /^attack_b.*\.mp3$/i,  action: 'attack_b' },
];

const TARGET_FILENAME = {
  standby:   'Standby_1.mp3',
  attack_a:  'ATKa_1.mp3',
  attack_b:  'ATKb_1.mp3',
};

// Pick the largest of the candidate files (by byte size).
function pickLargest(files) {
  return files
    .map((f) => ({ path: f, size: statSync(f).size }))
    .sort((a, b) => b.size - a.size);
}

function findActionFile(stageDir, actionRegex) {
  const entries = readdirSync(stageDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && actionRegex.test(e.name))
    .map((e) => join(stageDir, e.name));
}

const summary = [];

for (let stage = 1; stage <= 4; stage++) {
  const stageDir = join(SOURCE_ROOT, `stage${stage}`);
  if (!existsSync(stageDir)) {
    console.error(`[voice] stage directory missing: ${stageDir}`);
    process.exit(1);
  }

  const targetDir = join(TARGET_ROOT, `Voice_${stage}`);
  if (!isDry) mkdirSync(targetDir, { recursive: true });

  for (const { regex, action } of ACTION_PATTERNS) {
    const candidates = findActionFile(stageDir, regex);
    if (candidates.length === 0) {
      console.error(`[voice] no candidate for stage ${stage} action ${action}`);
      process.exit(1);
    }
    const ranked = pickLargest(candidates);
    const primary = ranked[0].path;
    const targetName = TARGET_FILENAME[action];
    const targetPath = join(targetDir, targetName);

    if (!isDry) copyFileSync(primary, targetPath);

    summary.push({
      stage,
      action,
      picked: primary.replace(ROOT + '\\', ''),
      sizeKB: Math.round(ranked[0].size / 1024),
      target: targetPath.replace(ROOT + '\\', ''),
      alternates: ranked.slice(1).map((r) => ({
        file: r.path.replace(ROOT + '\\', ''),
        sizeKB: Math.round(r.size / 1024),
      })),
    });

    // Copy alternates as `_2` / `_3` for future random-pick support.
    if (!isDry) {
      ranked.slice(1).forEach((alt, idx) => {
        const altName = targetName.replace(/(\.mp3)$/i, `_${idx + 2}.mp3`);
        copyFileSync(alt.path, join(targetDir, altName));
      });
    }
  }
}

console.log(isDry ? '─ DRY RUN ─ mapping plan ─' : '✓ Voice assets copied.');
console.log('─ Per-stage mapping ─');
for (const row of summary) {
  console.log(`  Voice_${row.stage} / ${row.action}`);
  console.log(`    primary: ${row.picked} (${row.sizeKB} KB) → ${row.target}`);
  for (const alt of row.alternates) {
    console.log(`    alt:     ${alt.file} (${alt.sizeKB} KB)`);
  }
}
console.log(`\n${isDry ? '[dry]' : '✓'} done. ${summary.length} primary files${isDry ? ' (NOT copied)' : ' copied + alternates'}.`);