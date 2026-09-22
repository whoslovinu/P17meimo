import { NextResponse } from 'next/server';
import { getRedisClient, REDIS_KEYS } from '@/lib/redis';
import { requireAdminAuth } from '@/app/lib/adminAuth';

// Dedicated unified config key for REPARK
const REPARK_CONFIG_KEY = 'repark:activity:config';

// ════════════════════════════════════════════════════════════════════════════════
// INTERFACE: Stage thresholds auto-calculated from bossMaxHp
// ════════════════════════════════════════════════════════════════════════════════
export interface StageConfig {
  stage1Threshold: number; // 75% of maxHp
  stage2Threshold: number; // 50% of maxHp
  stage3Threshold: number; // 25% of maxHp
  stage4Threshold: number; // 0% (always 0)
}

export interface ConfigPayload {
  config: {
    activityEnabled: boolean;
    activityName: string;
    startTime: string;
    endTime: string;
    rules: string;
    bossMaxHp: number;
    attackDamageMin: number;
    attackDamageMax: number;
    countdownEndDate: string;
  };
  milestones?: Array<{
    id: number;
    hp_threshold: number;
    name: string;
    emoji: string;
  }>;
}

// ════════════════════════════════════════════════════════════════════════════════
// SINGLE TRUTH: Auto-calculate stage thresholds from bossMaxHp
// ════════════════════════════════════════════════════════════════════════════════
function calculateStages(maxHp: number): StageConfig {
  const s1 = Math.floor(maxHp * 0.75);
  const s2 = Math.floor(maxHp * 0.50);
  const s3 = Math.floor(maxHp * 0.25);
  return {
    stage1Threshold: s1,
    stage2Threshold: s2,
    stage3Threshold: s3,
    stage4Threshold: 0,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// VALIDATION: Strict numeric checks
// ════════════════════════════════════════════════════════════════════════════════
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateNumeric(value: unknown, fieldName: string, min: number = 0, max?: number): string | null {
  if (value === undefined || value === null) {
    return `Field '${fieldName}' is required`;
  }
  const num = Number(value);
  if (isNaN(num)) {
    return `Field '${fieldName}' must be a valid number`;
  }
  if (num < min) {
    return `Field '${fieldName}' must be >= ${min}`;
  }
  if (max !== undefined && num > max) {
    return `Field '${fieldName}' must be <= ${max}`;
  }
  return null;
}

function validateConfig(config: ConfigPayload['config']): ValidationResult {
  const errors: string[] = [];
  
  const hpError = validateNumeric(config.bossMaxHp, 'bossMaxHp', 1);
  if (hpError) errors.push(hpError);
  
  const minDmgError = validateNumeric(config.attackDamageMin, 'attackDamageMin', 0);
  if (minDmgError) errors.push(minDmgError);
  
  const maxDmgError = validateNumeric(config.attackDamageMax, 'attackDamageMax', 0);
  if (maxDmgError) errors.push(maxDmgError);
  
  if (!isNaN(Number(config.attackDamageMin)) && !isNaN(Number(config.attackDamageMax))) {
    if (config.attackDamageMin > config.attackDamageMax) {
      errors.push('attackDamageMin cannot be greater than attackDamageMax');
    }
  }
  
  if (typeof config.activityEnabled !== 'boolean') {
    errors.push('activityEnabled must be a boolean');
  }
  
  if (typeof config.activityName !== 'string' || config.activityName.trim() === '') {
    errors.push('activityName is required');
  }
  
  return { valid: errors.length === 0, errors };
}

// ════════════════════════════════════════════════════════════════════════════════
// STORAGE: Unified REPARK config object stored as single JSON
// ════════════════════════════════════════════════════════════════════════════════
interface StoredConfig {
  activityEnabled: boolean;
  activityName: string;
  startTime: string;
  endTime: string;
  rules: string;
  bossMaxHp: number;
  attackDamageMin: number;
  attackDamageMax: number;
  countdownEndDate: string;
  stages: StageConfig;
  milestones: Array<{
    id: number;
    hp_threshold: number;
    name: string;
    emoji: string;
  }>;
  updatedAt: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// POST: NO-LIES PROTOCOL - Redis is MANDATORY
// If Redis is unavailable, this endpoint FAILS with 503
// ════════════════════════════════════════════════════════════════════════════════
export async function POST(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  try {
    let payload: ConfigPayload;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON payload' } },
        { status: 400 }
      );
    }

    const { config, milestones } = payload;

    console.log('[REPARK POST /api/admin/config] ════════════════════════════════');
    console.log('[REPARK POST] Received payload:');
    console.log(JSON.stringify(payload, null, 2));

    // Validate required fields
    if (!config) {
      return NextResponse.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing config data' } },
        { status: 400 }
      );
    }

    // ════════════════════════════════════════════════════════════════════════════
    // STEP 1: Validate before any storage operation
    // ════════════════════════════════════════════════════════════════════════════
    const validation = validateConfig(config);
    if (!validation.valid) {
      console.warn('[REPARK POST] Validation failed:', validation.errors);
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid config values', details: validation.errors } },
        { status: 400 }
      );
    }

    // ════════════════════════════════════════════════════════════════════════════
    // STEP 2: IMMEDIATELY calculate stages from bossMaxHp
    // ════════════════════════════════════════════════════════════════════════════
    const stages = calculateStages(config.bossMaxHp);
    
    console.log('[REPARK POST] ════════════════════════════════════════════════');
    console.log('[REPARK POST] STAGE CALCULATION (Auto-derived from bossMaxHp):');
    console.log(`[REPARK POST]   bossMaxHp = ${config.bossMaxHp}`);
    console.log(`[REPARK POST]   stage1Threshold (75%) = ${stages.stage1Threshold}`);
    console.log(`[REPARK POST]   stage2Threshold (50%) = ${stages.stage2Threshold}`);
    console.log(`[REPARK POST]   stage3Threshold (25%) = ${stages.stage3Threshold}`);
    console.log(`[REPARK POST]   stage4Threshold (0%)  = ${stages.stage4Threshold}`);
    console.log('[REPARK POST] ════════════════════════════════════════════════');

    // ════════════════════════════════════════════════════════════════════════════
    // STEP 3: NO-LIES PROTOCOL - Redis is MANDATORY
    // If Redis is unavailable, RETURN 503 with REDIS_CONNECTION_FAILED
    // DO NOT fallback to memory
    // ════════════════════════════════════════════════════════════════════════════
    let redisClient: ReturnType<typeof getRedisClient>;
    
    try {
      redisClient = getRedisClient();
      await redisClient.ping();
      console.log('[REPARK POST] Redis: CONNECTED ✓');
    } catch (redisError) {
      // ════════════════════════════════════════════════════════════════════════
      // REDIS UNAVAILABLE - FAIL HARD
      // ════════════════════════════════════════════════════════════════════════
      console.error('[REPARK POST] ════════════════════════════════════════════════');
      console.error('[REPARK POST] REDIS CONNECTION FAILED');
      console.error('[REPARK POST] Error:', redisError instanceof Error ? redisError.message : redisError);
      console.error('[REPARK POST] Request: "REDIS_CONNECTION_FAILED"');
      console.error('[REPARK POST] ════════════════════════════════════════════════');
      
      return NextResponse.json(
        { 
          ok: false, 
          error: { 
            code: 'REDIS_CONNECTION_FAILED', 
            message: 'REDIS_CONNECTION_FAILED' 
          } 
        },
        { status: 503 }
      );
    }

    // ════════════════════════════════════════════════════════════════════════════
    // STEP 4: Build unified config object
    // ════════════════════════════════════════════════════════════════════════════
    const storedConfig: StoredConfig = {
      activityEnabled: config.activityEnabled,
      activityName: config.activityName,
      startTime: config.startTime,
      endTime: config.endTime,
      rules: config.rules,
      bossMaxHp: config.bossMaxHp,
      attackDamageMin: config.attackDamageMin,
      attackDamageMax: config.attackDamageMax,
      countdownEndDate: config.countdownEndDate,
      stages,
      milestones: milestones ?? [],
      updatedAt: new Date().toISOString(),
    };

    // ════════════════════════════════════════════════════════════════════════════
    // STEP 5: Save to Redis (NO MEMORY FALLBACK)
    // ════════════════════════════════════════════════════════════════════════════
    const serialized = JSON.stringify(storedConfig);
    
    try {
      // Save to dedicated key
      await redisClient.set(REPARK_CONFIG_KEY, serialized);
      console.log('[REPARK POST] SET:', REPARK_CONFIG_KEY);
      
      // Also update boss HP key (STANDARDIZED: boss:hp)
      await redisClient.set(REDIS_KEYS.BOSS_HP, String(config.bossMaxHp));
      await redisClient.set(REDIS_KEYS.BOSS_MAX_HP, String(config.bossMaxHp));
      console.log('[REPARK POST] SET:', REDIS_KEYS.BOSS_HP, '=', config.bossMaxHp);
    } catch (setError) {
      console.error('[REPARK POST] Redis SET failed:', setError instanceof Error ? setError.message : setError);
      return NextResponse.json(
        { ok: false, error: { code: 'REDIS_WRITE_FAILED', message: 'Failed to write to Redis' } },
        { status: 500 }
      );
    }

    // ════════════════════════════════════════════════════════════════════════════
    // STEP 6: FORCE READ-BACK verification
    // ════════════════════════════════════════════════════════════════════════════
    let verifiedData: string | null;
    try {
      verifiedData = await redisClient.get(REPARK_CONFIG_KEY);
    } catch (getError) {
      console.error('[REPARK POST] Redis GET failed:', getError instanceof Error ? getError.message : getError);
      return NextResponse.json(
        { ok: false, error: { code: 'REDIS_READ_FAILED', message: 'Failed to verify saved data' } },
        { status: 500 }
      );
    }
    
    if (!verifiedData) {
      console.error('[REPARK POST] READ-BACK FAILED: Could not verify saved config!');
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Read-back verification failed' } },
        { status: 500 }
      );
    }

    // Verify key fields
    let verifiedConfig: StoredConfig;
    try {
      verifiedConfig = JSON.parse(verifiedData);
    } catch {
      console.error('[REPARK POST] JSON parse failed');
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Data integrity check failed' } },
        { status: 500 }
      );
    }

    const verifyMatch = 
      verifiedConfig.bossMaxHp === config.bossMaxHp &&
      verifiedConfig.stages.stage1Threshold === stages.stage1Threshold &&
      verifiedConfig.stages.stage2Threshold === stages.stage2Threshold &&
      verifiedConfig.stages.stage3Threshold === stages.stage3Threshold;

    if (!verifyMatch) {
      console.error('[REPARK POST] READ-BACK MISMATCH!');
      console.error('[REPARK POST] Expected stages:', stages);
      console.error('[REPARK POST] Got stages:', verifiedConfig.stages);
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Data integrity check failed' } },
        { status: 500 }
      );
    }

    console.log('[REPARK POST] READ-BACK VERIFIED ✓');
    console.log(`[REPARK POST] ════════════════════════════════════════════════`);
    console.log(`[REPARK POST] COMPLETE: Config saved to Redis and verified`);
    console.log(`[REPARK POST] ════════════════════════════════════════════════`);

    return NextResponse.json({
      ok: true,
      data: {
        saved: true,
        storage: 'redis',
        stages,
        verified: true,
      },
    });
  } catch (error) {
    console.error('[REPARK POST] FATAL ERROR:', error instanceof Error ? error.stack : error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to save config' } },
      { status: 500 }
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// GET: Return stored config with stages
// Also requires Redis - returns 503 if unavailable
// ════════════════════════════════════════════════════════════════════════════════
export async function GET(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  try {
    let redisClient: ReturnType<typeof getRedisClient>;
    
    try {
      redisClient = getRedisClient();
      await redisClient.ping();
    } catch (redisError) {
      console.error('[REPARK GET] REDIS CONNECTION FAILED');
      console.error('[REPARK GET] Error:', redisError instanceof Error ? redisError.message : redisError);
      
      return NextResponse.json(
        { 
          ok: false, 
          error: { 
            code: 'REDIS_CONNECTION_FAILED', 
            message: 'REDIS_CONNECTION_FAILED' 
          } 
        },
        { status: 503 }
      );
    }

    // Load from Redis
    let data: string | null;
    try {
      data = await redisClient.get(REPARK_CONFIG_KEY);
    } catch {
      return NextResponse.json(
        { ok: false, error: { code: 'REDIS_READ_FAILED', message: 'Failed to fetch config' } },
        { status: 500 }
      );
    }

    if (!data) {
      // Return default config if no stored data
      const defaultStages = calculateStages(100000);
      return NextResponse.json({
        ok: true,
        data: {
          config: {
            activityEnabled: true,
            activityName: '魅魔挑战',
            startTime: '',
            endTime: '',
            rules: '',
            bossMaxHp: 100000,
            attackDamageMin: 10,
            attackDamageMax: 30,
            countdownEndDate: '',
          },
          stages: defaultStages,
          milestones: [],
          storage: 'redis',
        },
      });
    }

    const storedConfig = JSON.parse(data) as StoredConfig;

    return NextResponse.json({
      ok: true,
      data: {
        config: {
          activityEnabled: storedConfig.activityEnabled,
          activityName: storedConfig.activityName,
          startTime: storedConfig.startTime,
          endTime: storedConfig.endTime,
          rules: storedConfig.rules,
          bossMaxHp: storedConfig.bossMaxHp,
          attackDamageMin: storedConfig.attackDamageMin,
          attackDamageMax: storedConfig.attackDamageMax,
          countdownEndDate: storedConfig.countdownEndDate,
        },
        stages: storedConfig.stages,
        milestones: storedConfig.milestones,
        storage: 'redis',
        updatedAt: storedConfig.updatedAt,
      },
    });
  } catch (error) {
    console.error('[REPARK GET] Error:', error instanceof Error ? error.stack : error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch config' } },
      { status: 500 }
    );
  }
}
