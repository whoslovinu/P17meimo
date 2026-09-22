$path = 'H:\PROJECT\P17_H5meimo-demo\app\api\admin\users\[uid]\milestones\override\route.ts'
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash
Write-Output $hash
