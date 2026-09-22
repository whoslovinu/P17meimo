# scripts/drift-baseline.ps1 — READ ONLY
$ErrorActionPreference = 'Stop'
Set-Location 'H:\PROJECT\P17_H5meimo-demo'

$keys = 'PROD_PUBLIC_URL','DATABASE_URL','POSTGRES_HOST','POSTGRES_DB','POSTGRES_USER','POSTGRES_PASSWORD','REDIS_URL','INTERNAL_API_KEY','OWNER_KEY','ADMIN_PASSWORD','NEXTAUTH_URL','ADMIN_COOKIE_NAME','ALIAS_PEPPER'

foreach ($file in @('.env.local','.env.production','.env')) {
  $full = Join-Path (Get-Location) $file
  if (-not (Test-Path $full)) { continue }
  Write-Host ("===== {0} =====" -f $file)
  Get-Content $full | ForEach-Object {
    $line = $_
    foreach ($k in $keys) {
      $prefix = $k + '='
      if ($line.StartsWith($prefix)) {
        $v = $line.Substring($prefix.Length)
        $red = ''
        if ($v.Length -gt 0) { $red = $v.Substring(0, [Math]::Min(60, $v.Length)) + '...' }
        Write-Host ("{0}={1}" -f $k, $red)
      }
    }
  }
}