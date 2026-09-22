/**
 * Character Profile — single source of truth.
 *
 * Stored inside the activity's `config` JSONB column under the key
 * `character_profile`. Shaped so the admin form can author it directly
 * and the H5 client can consume it with safe fallbacks.
 *
 * All fields are OPTIONAL. When a field is missing or empty, the H5
 * `CharacterIntroPanel` falls back to DEFAULT_* constants. This means
 * the admin may opt out of any subset (e.g. keep the default stage
 * names but override just the bio entries).
 */

export interface CharacterBioItem {
  label: string;
  value: string;
}

export interface CharacterSkillItem {
  name: string;
  desc: string;
}

export interface CharacterStageColor {
  /** Tailwind-style gradient class applied to the stage badge. */
  className?: string;
}

export interface CharacterProfileConfig {
  /** Display name (used by future extension points; panel still indexes by stageName). */
  characterName?: string;
  /** 4 stage form names; indexed by stageIdx (0..3). */
  stageNames?: string[];
  /** Optional per-stage color overrides (kept simple — class names only). */
  stageColors?: CharacterStageColor[];
  /** Bio rows (种族 / 等级 / 危险度). */
  bio?: CharacterBioItem[];
  /** Skill list (技能 1..N). */
  skills?: CharacterSkillItem[];
}

/** Module-level defaults — never null. */
export const DEFAULT_STAGE_NAMES: readonly string[] = [
  '初始形态',
  '觉醒形态',
  '烈焰形态',
  '暗影形态',
];

export const DEFAULT_STAGE_COLORS: readonly string[] = [
  'from-purple-600/80 to-pink-600/80',
  'from-blue-600/80 to-cyan-600/80',
  'from-orange-600/80 to-red-600/80',
  'from-gray-700/80 to-zinc-600/80',
];

export const DEFAULT_BIO: readonly CharacterBioItem[] = [
  { label: '种族', value: '深渊魅魔' },
  { label: '等级', value: 'Lv.∞' },
  { label: '危险度', value: '★★★★★' },
];

export const DEFAULT_SKILLS: readonly CharacterSkillItem[] = [
  { name: '灵魂汲取', desc: '每次攻击偷取目标生命力' },
  { name: '心魔之触', desc: '穿透防御，直接伤害灵魂' },
  { name: '深渊凝视', desc: '降低目标全属性 20%' },
];

/**
 * Coerce an opaque JSON blob (e.g. `cfg?.character_profile` straight out of
 * the DB) into a defended `CharacterProfileConfig`. Returns a fully empty
 * object if the input is malformed or null — callers MUST fall back to the
 * DEFAULT_* constants individually for any missing field.
 */
export function normalizeCharacterProfile(input: unknown): CharacterProfileConfig {
  if (!input || typeof input !== 'object') return {};
  const src = input as Record<string, unknown>;

  const stageNames = Array.isArray(src.stageNames)
    ? src.stageNames
        .filter((v): v is string => typeof v === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : undefined;

  const stageColors = Array.isArray(src.stageColors)
    ? src.stageColors
        .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
        .map((v) => ({
          className: typeof v.className === 'string' ? v.className : undefined,
        }))
    : undefined;

  const bio = Array.isArray(src.bio)
    ? src.bio
        .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
        .map((v) => ({
          label: typeof v.label === 'string' ? v.label : '',
          value: typeof v.value === 'string' ? v.value : '',
        }))
        .filter((b) => b.label.length > 0 || b.value.length > 0)
    : undefined;

  const skills = Array.isArray(src.skills)
    ? src.skills
        .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
        .map((v) => ({
          name: typeof v.name === 'string' ? v.name : '',
          desc: typeof v.desc === 'string' ? v.desc : '',
        }))
        .filter((s) => s.name.length > 0 || s.desc.length > 0)
    : undefined;

  return {
    characterName: typeof src.characterName === 'string' && src.characterName.length > 0
      ? src.characterName
      : undefined,
    stageNames,
    stageColors,
    bio,
    skills,
  };
}
