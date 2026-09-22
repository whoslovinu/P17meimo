#!/usr/bin/env bash
echo "=== verifyWebhookSignature.ts HMAC count ==="
tar -xzOf /tmp/repark-deploy-FRESH.tar.gz ./lib/security/verifyWebhookSignature.ts | grep -c HMAC

echo "=== SubPageModal.tsx rechargeThresholdYuan count ==="
tar -xzOf /tmp/repark-deploy-FRESH.tar.gz ./app/components/features/battle/SubPageModal.tsx | grep -c rechargeThresholdYuan

echo "=== app/api/battle/init/route.ts ==="
tar -xzOf /tmp/repark-deploy-FRESH.tar.gz ./app/api/battle/init/route.ts | grep -nE "cents|rechargeProgress|YUAN|FALLBACK_TASK_THRESHOLDS" | head -10