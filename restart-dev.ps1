# Kill all Next.js dev server processes
Get-Process -Name "node" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*next*" -or $_.CommandLine -like "*next-dev*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Killed Next.js dev processes"
Start-Sleep -Seconds 1

# Start dev server
$ErrorActionPreference = "Continue"
Start-Process -FilePath "npm" -ArgumentList "run","dev" -WorkingDirectory "h:\PROJECT\P17_H5meimo-demo" -WindowStyle Hidden -PassThru | Out-Null
Write-Host "Started new dev server"
Start-Sleep -Seconds 3

# Check if it's running
$running = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*browser*" -or $_.CommandLine -like "*next*" }
Write-Host "Node processes count: $(($running | Measure-Object).Count)"
