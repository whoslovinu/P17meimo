const fs = require('fs');
const panel = fs.readFileSync('app/components/features/battle/CharacterIntroPanel.tsx', 'utf8');
const lib = fs.readFileSync('app/lib/characterProfile.ts', 'utf8');
const admin = fs.readFileSync('app/admin/activities/[id]/config/page.tsx', 'utf8');
const apiInit = fs.readFileSync('app/api/battle/init/route.ts', 'utf8');
const apiUpdate = fs.readFileSync('app/api/admin/activity/update/route.ts', 'utf8');
const layout = fs.readFileSync('app/components/features/battle/BattleLayout.tsx', 'utf8');

const checks = [
  ['Type module exists', lib.includes('CharacterProfileConfig')],
  ['DEFAULT_BIO exported', lib.includes('export const DEFAULT_BIO')],
  ['DEFAULT_SKILLS exported', lib.includes('export const DEFAULT_SKILLS')],
  ['DEFAULT_STAGE_NAMES exported', lib.includes('export const DEFAULT_STAGE_NAMES')],
  ['normalizeCharacterProfile guard', lib.includes('normalizeCharacterProfile') && lib.includes("typeof v === 'string'")],

  ['Panel reads profile prop', panel.includes('profile?: CharacterProfileConfig')],
  ['Panel uses pickStageName', panel.includes('pickStageName(')],
  ['Panel uses pickBio fallback', panel.includes('pickBio(')],
  ['Panel uses pickSkills fallback', panel.includes('pickSkills(')],
  ['Panel renders bioRows dynamically', panel.includes('bioRows.map(')],
  ['Panel renders skillRows dynamically', panel.includes('skillRows.map(')],

  ['Admin imports CharacterBioItem/SkillItem', admin.includes('CharacterBioItem') && admin.includes('CharacterSkillItem')],
  ['Admin defines FormData.characterProfile', admin.includes("characterProfile: FormData['characterProfile']")],
  ['Admin mounts CharacterProfileSection', admin.includes('CharacterProfileSection')],
  ['Admin has section-profile id', admin.includes('id="section-profile"')],
  ['Admin serializes character_profile in save', admin.includes('character_profile: {')],
  ['Admin dynamically adds bio rows', admin.includes('addBio')],
  ['Admin dynamically adds skill rows', admin.includes('addSkill')],

  ['battle/init imports normalize', apiInit.includes('normalizeCharacterProfile')],
  ['battle/init returns character_profile', apiInit.includes('character_profile: activityConfig.characterProfile')],
  ['activity/update persists character_profile', apiUpdate.includes('character_profile: characterProfile')],

  ['BattleLayout holds characterProfile state', layout.includes('setCharacterProfile')],
  ['BattleLayout passes profile prop', layout.includes('profile={characterProfile ?? undefined}')],
];

let failed = 0;
checks.forEach(([k, ok]) => {
  console.log(ok ? 'OK ' + k : 'FAIL ' + k);
  if (!ok) failed++;
});
if (failed === 0) console.log('ALL_PASS');
else { console.error('FAILED', failed, 'checks'); process.exit(1); }
