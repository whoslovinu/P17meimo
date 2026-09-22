$pairs = @(
  @{k='search/route.ts';                            p='app\api\admin\users\search\route.ts'},
  @{k='override/route.ts';                          p='app\api\admin\users\[uid]\milestones\override\route.ts'},
  @{k='page.tsx (admin/users)';                     p='app\admin\users\page.tsx'},
  @{k='battle/init/route.ts';                       p='app\api\battle\init\route.ts'},
  @{k='SubPageModal.tsx';                           p='app\components\features\battle\SubPageModal.tsx'},
  @{k='milestone/claim/route.ts';                   p='app\api\game\milestone\claim\route.ts'},
  @{k='lib/db/pg.ts';                               p='lib\db\pg.ts'}
)
foreach ($pr in $pairs) {
  $path = "H:\PROJECT\P17_H5meimo-demo\$($pr.p)"
  if (Test-Path -LiteralPath $path) {
    $h = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash
    Write-Output ("$($pr.k)|$h|$($pr.p)")
  } else {
    Write-Output ("$($pr.k)|MISSING|$($pr.p)")
  }
}
