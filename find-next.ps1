Get-CimInstance Win32_Process -Filter "Name='node.exe'" -Property ProcessId,CommandLine |
    Select-Object ProcessId, CommandLine |
    Where-Object { $_.CommandLine -like "*node_modules*next*" } |
    ForEach-Object {
        Write-Host "PID: $($_.ProcessId) - $($_.CommandLine.Substring(0, [Math]::Min(80, $_.CommandLine.Length)))"
    }
