$ErrorActionPreference = 'Stop'
$src = 'H:\PROJECT\P17_H5meimo-demo'
$dst = 'H:\PROJECT\P17_H5meimo-demo\tmp_convergence'

# Clean dst
if (Test-Path $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }

# Files that need to be copied from the workspace (full src minus node_modules, .next, .git)
# Strategy: rsync via robocopy (skipping heavy dirs)
$excludeDirs = @('node_modules', '.next', '.git', '.audit', '.cursor', '.vscode', 'tmp_convergence', 'tmp_*', '.husky')
$excludeFiles = @('*.log', '*.tsbuildinfo')

# Use robocopy for speed
$robocopyArgs = @(
  $src, $dst,
  '/E',           # include empty dirs
  '/XD', $excludeDirs -join ' ',
  '/XF', 'package-lock.json', '.DS_Store'
)

Write-Output "Copying from $src to $dst..."
& robocopy @robocopyArgs | Out-Null
$exitCode = $LASTEXITCODE
Write-Output "robocopy exit code: $exitCode (1=files copied OK, 0=nothing to copy, 2+=extra)"
