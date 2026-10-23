param([Parameter(Mandatory=$true)][string]$NodePath,[Parameter(Mandatory=$true)][string]$Workspace)
$ErrorActionPreference = 'Stop'
$check = Start-Process -FilePath $NodePath -ArgumentList 'scripts/runtime-control.mjs ensure' -WorkingDirectory $Workspace -WindowStyle Hidden -PassThru
$check.WaitForExit()
exit $check.ExitCode
