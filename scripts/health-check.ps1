# scripts/health-check.ps1
# Windows PowerShell equivalent of scripts/health-check.sh.
# Read-only. Safe to run anywhere.

$ErrorActionPreference = 'Continue'

$ROOT = Resolve-Path "$PSScriptRoot\.."
Set-Location $ROOT

function Head([string]$title) { Write-Host "`n== $title ==" -ForegroundColor Cyan }
function Ok([string]$msg)    { Write-Host "OK  $msg" -ForegroundColor Green }
function Warn([string]$msg)  { Write-Host "WARN $msg" -ForegroundColor Yellow }
function Bad([string]$msg)   { Write-Host "FAIL $msg" -ForegroundColor Red }

Head 'P17 Health Check'
Write-Host "  cwd : $ROOT"
Write-Host "  date: $(Get-Date -Format 'o')"

# 1. TypeScript ─────────────────────────────────────────────────────────────
Head '[1/5] TypeScript'
$tsc = Join-Path $ROOT 'node_modules\.bin\tsc.cmd'
if (Test-Path $tsc) {
  & $tsc --noEmit 2>&1 | Tee-Object -Variable tscOut | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Ok '0 errors'
  } else {
    $errCount = ($tscOut | Select-String -Pattern 'error TS').Count
    Bad "$errCount errors"
    $tscOut | Select-String -Pattern 'error TS' | Select-Object -First 5 | ForEach-Object { Write-Host $_.Line }
  }
} else {
  Warn 'tsc not found at node_modules\.bin\tsc.cmd — run npm ci'
}

# 2. Production build ──────────────────────────────────────────────────────
Head '[2/5] Production build'
$buildId = Join-Path $ROOT '.next\BUILD_ID'
if (Test-Path $buildId) {
  Ok "BUILD_ID=$(Get-Content $buildId)"
} else {
  Warn 'no .next\BUILD_ID — run npm run build:no-lint'
}

# 3. Network Layer Hard Rule ───────────────────────────────────────────────
Head '[3/5] Network Layer Hard Rule (V6.0+)'
$bareFetch = (Get-ChildItem -Path 'app' -Recurse -Include '*.ts','*.tsx' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'fetchWithTimeout\.ts' -and $_.FullName -notmatch 'adminFetch\.ts' -and $_.FullName -notmatch 'adminApi\.ts' -and $_.FullName -notmatch '__tests__' } |
  Select-String -Pattern "(^|[^a-zA-Z_$.])fetch\s*\(\s*['""]" |
  Measure-Object).Count
$bareAxios = (Get-ChildItem -Path 'app' -Recurse -Include '*.ts','*.tsx' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '__tests__' } |
  Select-String -Pattern '\baxios\s*[\.\(]' |
  Measure-Object).Count
if ($bareFetch -eq 0 -and $bareAxios -eq 0) {
  Ok 'no bare fetch("...") or axios() in app/'
} else {
  Bad "$bareFetch bare fetch() + $bareAxios axios() calls in app/"
}

# 4. Routes ────────────────────────────────────────────────────────────────
Head '[4/5] Routes (build manifest)'
$manifest = Join-Path $ROOT '.next\app-build-manifest.json'
if (Test-Path $manifest) {
  $json = Get-Content $manifest -Raw | ConvertFrom-Json
  $pages = ($json.pages | Get-Member -MemberType NoteProperty).Count
  Write-Host "  $pages pages"
} else {
  Warn 'no .next\app-build-manifest.json — build first'
}

# 5. Latency gate (optional) ───────────────────────────────────────────────
Head '[5/5] Latency gate (requires running server on :3000)'
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:3000/api/time' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
  Ok '/api/time reachable'
  $env:BENCH_SAMPLE = '20'
  & node scripts\bench_attack.mjs --gate 2>&1 | Tee-Object -Variable benchOut | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Ok 'attack latency gate: PASS'
  } else {
    Bad 'attack latency gate: FAIL'
    $benchOut | Select-Object -Last 10 | ForEach-Object { Write-Host $_ }
  }
} catch {
  Warn '/api/time not reachable on localhost:3000 — start the server first'
}

Head 'Done.'
Write-Host '  Reference: docs/P17_BATTLE_PROTOCOL.md'