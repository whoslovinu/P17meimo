Get-ChildItem -LiteralPath 'H:\PROJECT\P17_H5meimo-demo\app\api\admin\users\[uid]\milestones\override\route.ts', 'H:\PROJECT\P17_H5meimo-demo\app\admin\users\page.tsx', 'H:\PROJECT\P17_H5meimo-demo\app\api\battle\init\route.ts', 'H:\PROJECT\P17_H5meimo-demo\app\components\features\battle\SubPageModal.tsx', 'H:\PROJECT\P17_H5meimo-demo\app\api\game\milestone\claim\route.ts', 'H:\PROJECT\P17_H5meimo-demo\lib\db\pg.ts' |
  ForEach-Object {
    $lines = (Get-Content -LiteralPath $_.FullName | Measure-Object -Line).Lines
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
    Write-Output ("$lines $hash $($_.FullName.Substring(40))")
  }
