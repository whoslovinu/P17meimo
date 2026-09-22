$ErrorActionPreference = "Continue"
Write-Host "=== 1. admin/login (dev) ===" -ForegroundColor Cyan
try {
    $body = '{"password":"dev"}'
    $r = Invoke-WebRequest -Uri "http://localhost:3000/api/admin/login" -Method POST -ContentType "application/json" -Body $body -TimeoutSec 5 -UseBasicParsing
    Write-Host "Status: $($r.StatusCode)" -ForegroundColor Green
    Write-Host "Set-Cookie: $($r.Headers['Set-Cookie'])"
} catch {
    Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== 2. boss/status (Redis check) ===" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "http://localhost:3000/api/boss/status" -TimeoutSec 5 -UseBasicParsing
    Write-Host "Status: $($r.StatusCode)" -ForegroundColor Green
    Write-Host "Body: $($r.Content.Substring(0, [Math]::Min(150, $r.Content.Length)))"
} catch {
    Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== 3. admin/validate POST ===" -ForegroundColor Cyan
try {
    $body = '{"secret":"dev"}'
    $r = Invoke-WebRequest -Uri "http://localhost:3000/api/admin/validate" -Method POST -ContentType "application/json" -Body $body -TimeoutSec 5 -UseBasicParsing
    Write-Host "Status: $($r.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
}
