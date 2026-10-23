param([Parameter(Mandatory=$true)][string]$NodePath,[Parameter(Mandatory=$true)][string]$Workspace)
$ErrorActionPreference = 'Stop'
$hasher = [Security.Cryptography.SHA256]::Create()
try { $hash = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Workspace)))).Replace('-','') } finally { $hasher.Dispose() }
$taskName = 'PrometeusCadence-' + $hash.Substring(0,12)
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + (Join-Path $Workspace 'scripts/runtime-ensure.ps1') + '" -NodePath "' + $NodePath + '" -Workspace "' + $Workspace + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $Workspace
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$recoveryTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(5) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger,$recoveryTrigger) -Principal $principal -Settings $settings -Force | Out-Null
Remove-Item -LiteralPath (Join-Path $Workspace '.runtime/paused') -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $taskName
Write-Output "Continuous runtime registered at Windows logon: $taskName"
