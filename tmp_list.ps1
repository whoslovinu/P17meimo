Get-ChildItem 'H:\PROJECT\P17_H5meimo-demo\app\api\admin\users' -Recurse |
  Where-Object { $_.Name -eq 'route.ts' } |
  ForEach-Object { Write-Output $_.FullName }
