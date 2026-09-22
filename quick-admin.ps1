$ErrorActionPreference = "Continue"
$body = '{"password":"dev"}'
try {
    $r = Invoke-WebRequest -Uri "http://localhost:3000/api/admin/login" -Method POST -ContentType "application/json" -Body $body -TimeoutSec 5 -UseBasicParsing
    Write-Host "Status: $($r.StatusCode)"
    Write-Host "Body: $($r.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
