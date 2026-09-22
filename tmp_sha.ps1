$files = @(
  'app\api\admin\users\search\route.ts',
  'app\api\admin\users\[uid]\milestones\override\route.ts',
  'app\admin\users\page.tsx',
  'app\api\battle\init\route.ts',
  'app\components\features\battle\SubPageModal.tsx',
  'app\api\game\milestone\claim\route.ts',
  'lib\db\pg.ts'
)
foreach ($f in $files) {
  if (Test-Path $f) {
    $h = (Get-FileHash -Algorithm SHA256 $f).Hash
    Write-Output ("$h  $f")
  } else {
    Write-Output ("MISSING  $f")
  }
}
