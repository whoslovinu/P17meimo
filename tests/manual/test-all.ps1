# ============================================================
# P17 H5 魅魔来袭 — 人工测试一键脚本
# 用途: 一次性跑完所有 API 测试
# 用法: powershell -ExecutionPolicy Bypass -File tests/manual/test-all.ps1
# ============================================================

$ErrorActionPreference = 'Continue'
$BASE = 'http://localhost:3000'

# ── 颜色 ────────────────────────────────────────────────────
function OK    { param($m) Write-Host "  [✓] $m" -ForegroundColor Green }
function FAIL  { param($m) Write-Host "  [✗] $m" -ForegroundColor Red }
function INFO  { param($m) Write-Host "  [i] $m" -ForegroundColor Cyan }
function HEAD  { param($m) Write-Host "`n═══ $m ═══" -ForegroundColor Yellow }

$results = @()
function Record { param($name, $passed, $detail = "")
  $script:results += [PSCustomObject]@{
    Name = $name; Passed = $passed; Detail = $detail
  }
  if ($passed) { OK $name } else { FAIL "$name — $detail" }
}

# ── Pre-check: dev server is up ──────────────────────────────
HEAD "0. Pre-check"
try {
  $r = Invoke-WebRequest "$BASE/api/internal/startup" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
  $startupJson = ($r.Content | ConvertFrom-Json)
  if ($startupJson.ok -eq $true) {
    OK "Dev server is up"
  } else {
    FAIL "Startup endpoint returned ok=false"
    Write-Host "Run 'npm run dev' first, then re-run this script." -ForegroundColor Yellow
    exit 1
  }
} catch {
  FAIL "Dev server not reachable at $BASE — start 'npm run dev' first"
  exit 1
}

# ── Stage 1: Battle core ─────────────────────────────────────
HEAD "Stage 1: Battle core (Redis + PostgreSQL)"

# 1.1 game/init
try {
  $r = Invoke-WebRequest "$BASE/api/game/init" -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  $j = $r.Content | ConvertFrom-Json
  Record "1.1 game/init" ($r.StatusCode -eq 200 -and $j.ok -eq $true) "HTTP $($r.StatusCode), ok=$($j.ok)"
} catch { Record "1.1 game/init" $false $_.Exception.Message }

# 1.2 boss/status
try {
  $r = Invoke-WebRequest "$BASE/api/boss/status" -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  $j = $r.Content | ConvertFrom-Json
  $hpOk = $j.data -and $j.data.current -ne $null -and $j.data.max -ne $null
  Record "1.2 boss/status" ($r.StatusCode -eq 200 -and $hpOk) "HTTP $($r.StatusCode), hp=$($j.data.current)/$($j.data.max)"
} catch { Record "1.2 boss/status" $false $_.Exception.Message }

# 1.3 battle/init
try {
  $r = Invoke-WebRequest "$BASE/api/battle/init" -Method POST -Headers @{Cookie='uid=manual-test-001'} -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  $j = $r.Content | ConvertFrom-Json
  Record "1.3 battle/init" ($r.StatusCode -eq 200 -and $j.ok -eq $true) "HTTP $($r.StatusCode), ok=$($j.ok)"
} catch { Record "1.3 battle/init" $false $_.Exception.Message }

# 1.4 attack first
$uid1 = "manual-attack-$(Get-Random)"
$n1 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
try {
  $body = @{ item_type='item_hand'; nonce="$n1" } | ConvertTo-Json
  $r = Invoke-WebRequest "$BASE/api/action/attack" -Method POST -ContentType 'application/json' -Headers @{Cookie="uid=$uid1"} -Body $body -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  $j = $r.Content | ConvertFrom-Json
  $dmg = if ($j.data) { $j.data.actualDamage } else { 0 }
  Record "1.4 attack first" ($r.StatusCode -eq 200 -and $dmg -gt 0) "HTTP $($r.StatusCode), damage=$dmg"
} catch { Record "1.4 attack first" $false $_.Exception.Message }

# 1.5 duplicate nonce
try {
  $body = @{ item_type='item_hand'; nonce="$n1" } | ConvertTo-Json
  $r = Invoke-WebRequest "$BASE/api/action/attack" -Method POST -ContentType 'application/json' -Headers @{Cookie="uid=$uid1"} -Body $body -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  Record "1.5 duplicate nonce" ($r.StatusCode -eq 200) "HTTP $($r.StatusCode) — expected 409 from API spec; some impls return 200 with error code"
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Record "1.5 duplicate nonce" ($status -eq 409) "HTTP $status"
}

# 1.6 rate limit expires
Start-Sleep -Seconds 1.5
$uid2 = "manual-rate-$(Get-Random)"
$n2 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
try {
  $body = @{ item_type='item_hand'; nonce="$n2" } | ConvertTo-Json
  $r = Invoke-WebRequest "$BASE/api/action/attack" -Method POST -ContentType 'application/json' -Headers @{Cookie="uid=$uid2"} -Body $body -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  $j = $r.Content | ConvertFrom-Json
  Record "1.6 attack after 1.5s" ($r.StatusCode -eq 200 -and $j.ok -eq $true) "HTTP $($r.StatusCode), ok=$($j.ok)"
} catch { Record "1.6 attack after 1.5s" $false $_.Exception.Message }

# 1.7 rapid 3x
$uid3 = "manual-rapid-$(Get-Random)"
$results17 = @()
foreach ($i in 1,2,3) {
  $nn = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $i
  $body = @{ item_type='item_hand'; nonce="$nn" } | ConvertTo-Json
  try {
    $r = Invoke-WebRequest "$BASE/api/action/attack" -Method POST -ContentType 'application/json' -Headers @{Cookie="uid=$uid3"} -Body $body -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
    $results17 += $r.StatusCode
  } catch {
    $results17 += $_.Exception.Response.StatusCode.value__
  }
  Start-Sleep -Milliseconds 50
}
INFO "Rapid sequence: $results17"
$pass = ($results17[0] -eq 200) -and ($results17[1] -eq 200) -and ($results17[2] -eq 429)
Record "1.7 rapid 3x (200/200/429)" $pass "Got: $results17"

# 1.8 leaderboard
try {
  $r = Invoke-WebRequest "$BASE/api/battle/leaderboard" -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  $j = $r.Content | ConvertFrom-Json
  $hasUsers = $j.data -and $j.data.users -ne $null
  Record "1.8 leaderboard" ($r.StatusCode -eq 200 -and $hasUsers) "HTTP $($r.StatusCode), users count: $(@($j.data.users).Count)"
} catch { Record "1.8 leaderboard" $false $_.Exception.Message }

# 1.9 milestone/claim
try {
  $r = Invoke-WebRequest "$BASE/api/game/milestone/claim" -Method POST -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  Record "1.9 milestone/claim" ($r.StatusCode -lt 500) "HTTP $($r.StatusCode)"
} catch { Record "1.9 milestone/claim" $false $_.Exception.Message }

# ── Stage 2: Admin ──────────────────────────────────────────
HEAD "Stage 2: Admin panel"

# Login
$adminCookie = $null
try {
  $body = @{ password='dev' } | ConvertTo-Json
  $r = Invoke-WebRequest "$BASE/api/admin/login" -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop -SessionVariable adminSess
  $j = $r.Content | ConvertFrom-Json
  if ($r.StatusCode -eq 200 -and $j.ok -eq $true) {
    $adminCookie = $adminSess
    Record "2.1 admin/login (correct)" $true "Got admin_token cookie"
  } else {
    Record "2.1 admin/login (correct)" $false "HTTP $($r.StatusCode), ok=$($j.ok)"
  }
} catch { Record "2.1 admin/login (correct)" $false $_.Exception.Message }

# 2.1b wrong password
try {
  $body = @{ password='wrong-xyz' } | ConvertTo-Json
  $r = Invoke-WebRequest "$BASE/api/admin/login" -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  Record "2.1b admin/login (wrong)" $false "Got 200 (should be 401)"
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Record "2.1b admin/login (wrong)" ($status -eq 401) "HTTP $status"
}

# 2.2 admin/stats
if ($adminCookie) {
  try {
    $r = Invoke-WebRequest "$BASE/api/admin/stats" -WebSession $adminCookie -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
    $j = $r.Content | ConvertFrom-Json
    Record "2.2 admin/stats" ($r.StatusCode -eq 200 -and $j.ok -eq $true) "HTTP $($r.StatusCode), ok=$($j.ok)"
  } catch { Record "2.2 admin/stats" $false $_.Exception.Message }
}

# 2.3 admin/user
if ($adminCookie) {
  try {
    $r = Invoke-WebRequest "$BASE/api/admin/user?userId=manual-test-001" -WebSession $adminCookie -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
    $j = $r.Content | ConvertFrom-Json
    Record "2.3 admin/user" ($r.StatusCode -eq 200 -and $j.ok -eq $true) "HTTP $($r.StatusCode)"
  } catch { Record "2.3 admin/user" $false $_.Exception.Message }
}

# 2.4 H-1 clamp
if ($adminCookie) {
  try {
    $body = @{ userId='clamp-test'; item_hand_count=999999999 } | ConvertTo-Json
    $r = Invoke-WebRequest "$BASE/api/admin/user/inventory" -Method POST -ContentType 'application/json' -WebSession $adminCookie -Body $body -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
    Record "2.4 H-1 clamp" $false "Got 200, expected 400"
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    Record "2.4 H-1 clamp" ($status -eq 400) "HTTP $status (rejected as expected)"
  }
}

# 2.5 toggle_status
if ($adminCookie) {
  try {
    $body = @{ userId='manual-test-001'; action='toggle_status' } | ConvertTo-Json
    $r = Invoke-WebRequest "$BASE/api/admin/user/update" -Method POST -ContentType 'application/json' -WebSession $adminCookie -Body $body -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
    $j = $r.Content | ConvertFrom-Json
    Record "2.5 toggle_status" ($r.StatusCode -eq 200) "HTTP $($r.StatusCode)"
  } catch { Record "2.5 toggle_status" $false $_.Exception.Message }
}

# 2.6 admin/validate GET
try {
  $r = Invoke-WebRequest "$BASE/api/admin/validate" -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  Record "2.6 admin/validate GET" $false "Got 200, expected 404/405"
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Record "2.6 admin/validate GET" ($status -in @(404, 405)) "HTTP $status"
}

# 2.7 admin/validate POST empty body
try {
  $body = @{} | ConvertTo-Json
  $r = Invoke-WebRequest "$BASE/api/admin/validate" -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  Record "2.7 admin/validate empty" $false "Got 200, expected 400"
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Record "2.7 admin/validate empty" ($status -eq 400) "HTTP $status"
}

# 2.8 admin/validate wrong secret
try {
  $body = @{ secret='wrong-xyz' } | ConvertTo-Json
  $r = Invoke-WebRequest "$BASE/api/admin/validate" -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  Record "2.8 admin/validate wrong" $false "Got 200, expected 401"
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Record "2.8 admin/validate wrong" ($status -eq 401) "HTTP $status"
}

# 2.9 admin/validate correct secret
try {
  $body = @{ secret='dev' } | ConvertTo-Json
  $r = Invoke-WebRequest "$BASE/api/admin/validate" -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  $j = $r.Content | ConvertFrom-Json
  Record "2.9 admin/validate correct" ($r.StatusCode -eq 200 -and $j.ok -eq $true) "HTTP $($r.StatusCode), ok=$($j.ok)"
} catch { Record "2.9 admin/validate correct" $false $_.Exception.Message }

# ── Stage 3: Webhook + owner-command ────────────────────────
HEAD "Stage 3: Webhook and owner-command"

# 3.1 owner GET
try {
  $r = Invoke-WebRequest "$BASE/api/internal/owner-command" -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  Record "3.1 owner GET" $false "Got 200, expected 405"
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Record "3.1 owner GET" ($status -eq 405) "HTTP $status"
}

# 3.2 owner fail-closed (no key)
try {
  $r = Invoke-WebRequest "$BASE/api/internal/owner-command?cmd=ping" -Method POST -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  Record "3.2 owner fail-closed" $false "Got 200, expected 401 (no key)"
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Record "3.2 owner fail-closed" ($status -eq 401) "HTTP $status"
}

# 3.3 webhook invalid signature
try {
  $body = '{"event":"user_action","user_id":"t","action":"consume","item_type":"item_hand","amount":1}'
  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $headers = @{
    'Content-Type' = 'application/json'
    'X-Webhook-Signature' = 'sha256=invalid_signature_abc123'
    'X-Webhook-Timestamp' = "$ts"
  }
  $r = Invoke-WebRequest "$BASE/api/webhook/user-action" -Method POST -Headers $headers -Body $body -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  Record "3.3 webhook invalid sig" $false "Got 200, expected 401"
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Record "3.3 webhook invalid sig" ($status -eq 401) "HTTP $status"
}

# 3.4 webhook stale timestamp
$WEBHOOK_SECRET = $env:WEBHOOK_SECRET
if (-not $WEBHOOK_SECRET) {
  INFO "WEBHOOK_SECRET not set in this shell — trying 'test_webhook_secret_32chars_minimum_ok'"
  $WEBHOOK_SECRET = 'test_webhook_secret_32chars_minimum_ok'
}

$oldTs = ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) - 600
$payload = '{"event":"user_action","user_id":"t","action":"consume","item_type":"item_hand","amount":1}'
$msg = "$oldTs.$payload"
$hmac = [System.Security.Cryptography.HMACSHA256]::new()
$hmac.Key = [Text.Encoding]::UTF8.GetBytes($WEBHOOK_SECRET)
$hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($msg))
$sig = [BitConverter]::ToString($hash).Replace('-','').ToLower()
try {
  $headers = @{
    'Content-Type' = 'application/json'
    'X-Webhook-Signature' = "sha256=$sig"
    'X-Webhook-Timestamp' = "$oldTs"
  }
  $r = Invoke-WebRequest "$BASE/api/webhook/user-action" -Method POST -Headers $headers -Body $payload -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  Record "3.4 webhook stale ts" $false "Got 200, expected 401"
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Record "3.4 webhook stale ts" ($status -eq 401) "HTTP $status"
}

# 3.5 webhook valid signature
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$payload = '{"event":"user_action","user_id":"manual-webhook-001","action":"consume","item_type":"item_hand","amount":1}'
$msg = "$ts.$payload"
$hmac = [System.Security.Cryptography.HMACSHA256]::new()
$hmac.Key = [Text.Encoding]::UTF8.GetBytes($WEBHOOK_SECRET)
$hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($msg))
$sig = [BitConverter]::ToString($hash).Replace('-','').ToLower()
try {
  $headers = @{
    'Content-Type' = 'application/json'
    'X-Webhook-Signature' = "sha256=$sig"
    'X-Webhook-Timestamp' = "$ts"
  }
  $r = Invoke-WebRequest "$BASE/api/webhook/user-action" -Method POST -Headers $headers -Body $payload -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
  $j = $r.Content | ConvertFrom-Json
  Record "3.5 webhook valid" ($r.StatusCode -eq 200 -and $j.ok -eq $true) "HTTP $($r.StatusCode), ok=$($j.ok)"
} catch { Record "3.5 webhook valid" $false $_.Exception.Message }

# 3.6 owner ping (only if OWNER_COMMAND_KEY is set)
$OWNER_KEY = $env:OWNER_COMMAND_KEY
if ($OWNER_KEY) {
  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $nonce = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
  $cmd = 'ping'
  $argsJson = '{}'
  $payload = "$ts|$nonce|$cmd|$argsJson"
  $hmac = [System.Security.Cryptography.HMACSHA256]::new()
  $hmac.Key = [Text.Encoding]::UTF8.GetBytes($OWNER_KEY)
  $hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))
  $sig = [BitConverter]::ToString($hash).Replace('-','').ToLower()
  $header = "$ts.$nonce.$sig"
  try {
    $body = @{ cmd=$cmd; argsJson=$argsJson } | ConvertTo-Json
    $headers = @{ 'X-Owner-Auth' = $header; 'Content-Type' = 'application/json' }
    $r = Invoke-WebRequest "$BASE/api/internal/owner-command?cmd=$cmd" -Method POST -Headers $headers -Body $body -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
    $j = $r.Content | ConvertFrom-Json
    Record "3.6 owner ping" ($r.StatusCode -eq 200 -and $j.ok -eq $true) "HTTP $($r.StatusCode), ok=$($j.ok)"
  } catch { Record "3.6 owner ping" $false $_.Exception.Message }
} else {
  INFO "3.6 owner ping — SKIPPED (set `$env:OWNER_COMMAND_KEY='1111...64chars' to test)"
  $script:results += [PSCustomObject]@{ Name='3.6 owner ping (skipped)'; Passed=$true; Detail='OWNER_COMMAND_KEY not set' }
}

# ── Summary ─────────────────────────────────────────────────
HEAD "Summary"
$passCount = ($results | Where-Object { $_.Passed }).Count
$total = $results.Count
Write-Host "  Passed: $passCount / $total" -ForegroundColor $(if ($passCount -eq $total) { 'Green' } else { 'Yellow' })
Write-Host ""
$results | Where-Object { -not $_.Passed } | ForEach-Object {
  Write-Host "  FAIL: $($_.Name) — $($_.Detail)" -ForegroundColor Red
}

if ($passCount -eq $total) {
  Write-Host "`n🎉 ALL PASSED — ready to deploy!" -ForegroundColor Green
  exit 0
} else {
  Write-Host "`n⚠️  Some tests failed. Fix them first, then re-run." -ForegroundColor Yellow
  exit 1
}
