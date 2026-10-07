# Canon in the background on Windows (0.18.0): a Task Scheduler task that starts Canon when the computer starts —
# before anyone signs in, with no window — and starts it again if it stops by itself. It runs start-canon.bat (so
# updates, canon.local.bat and the restarts work as before) as the account that installs it. Canon's icon in the
# notification area (scripts\canon-tray.ps1) shows that it is running and its address, and its Exit stops Canon.
#
#   powershell -ExecutionPolicy Bypass -File scripts\windows-task.ps1 install     (as administrator, once)
#   powershell -ExecutionPolicy Bypass -File scripts\windows-task.ps1 status
#   powershell -ExecutionPolicy Bypass -File scripts\windows-task.ps1 restart     (after an update)
#   powershell -ExecutionPolicy Bypass -File scripts\windows-task.ps1 stop | start
#   powershell -ExecutionPolicy Bypass -File scripts\windows-task.ps1 uninstall   (as administrator: back to the window)
#
# Windows asks for the account's password once, when the task is installed, so it can run while nobody is signed
# in. The password goes to Windows only; this script does not keep it. What Canon does is in data\logs.
param([Parameter(Position = 0)][ValidateSet('install', 'uninstall', 'start', 'stop', 'restart', 'status')][string]$Command = 'status')

$ErrorActionPreference = 'Stop'
$TaskName = 'Canon'
$Root = Split-Path -Parent $PSScriptRoot
$Tray = Join-Path $PSScriptRoot 'canon-tray.ps1'
# the Start-menu shortcut, and the same in Startup so the icon appears when someone signs in
$Shortcuts = @((Join-Path ([Environment]::GetFolderPath('Programs')) 'Canon.lnk'), (Join-Path ([Environment]::GetFolderPath('Startup')) 'Canon.lnk'))

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# the port Canon listens on: canon.local.bat's CANON_PORT, else 3000
function Get-Port {
  $local = Join-Path $Root 'canon.local.bat'
  if (Test-Path $local) {
    $m = Select-String -Path $local -Pattern 'CANON_PORT=(\d+)' | Select-Object -First 1
    if ($m) { return [int]$m.Matches[0].Groups[1].Value }
  }
  return 3000
}

function Test-Listening { [bool](Get-NetTCPConnection -LocalPort (Get-Port) -State Listen -ErrorAction SilentlyContinue) }

# Stop Canon properly (as the tray's Exit: running requests finish, the database is closed); if it doesn't answer
# (an older Canon, or it hangs), end its processes — whatever listens on the port and the launcher above it.
function Stop-Canon {
  if (-not (Test-Listening)) { return }
  $file = Join-Path $Root "data\run\control-$(Get-Port).json"
  try {
    $token = (Get-Content $file -Raw | ConvertFrom-Json).token
    Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$(Get-Port)/control/stop" -Headers @{ 'X-Canon-Control' = $token } -TimeoutSec 5 | Out-Null
    for ($i = 0; $i -lt 30 -and (Test-Listening); $i++) { Start-Sleep -Milliseconds 500 }
  } catch { }
  $conn = Get-NetTCPConnection -LocalPort (Get-Port) -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conn) { return }
  $procs = Get-CimInstance Win32_Process
  $p = $procs | Where-Object ProcessId -eq $conn.OwningProcess
  $chain = @()
  while ($p -and $p.Name -in @('node.exe', 'cmd.exe')) {
    $chain += $p
    $p = $procs | Where-Object ProcessId -eq $p.ParentProcessId
  }
  # the launcher first, so it doesn't start Canon again
  [array]::Reverse($chain)
  foreach ($c in $chain) { Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Get-CanonTask { Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
function Get-TrayProcess { Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object CommandLine -like '*canon-tray.ps1*' }

switch ($Command) {
  'install' {
    if (-not (Test-Admin)) { throw 'Run this as administrator (right-click PowerShell > Run as administrator).' }
    if (-not (Test-Path (Join-Path $Root 'start-canon.bat'))) { throw "start-canon.bat was not found in $Root." }
    $user = "$env:USERDOMAIN\$env:USERNAME"
    $cred = Get-Credential -UserName $user -Message "Canon will run as $user, also when nobody is signed in. Windows needs this account's password once."
    if (-not $cred) { throw 'Cancelled.' }
    # start-canon.bat with CANON_BACKGROUND=1: no window, no "press a key" pauses
    $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c "set CANON_BACKGROUND=1&& call start-canon.bat"' -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Description 'Canon church management (starts with Windows; see data\logs)' `
      -Action $action -Trigger $trigger -Settings $settings -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Limited -Force | Out-Null
    # the account may start and stop its own task without administrator rights (the tray icon, restart after an update)
    try {
      $sid = (New-Object Security.Principal.NTAccount($cred.UserName)).Translate([Security.Principal.SecurityIdentifier]).Value
      $svc = New-Object -ComObject Schedule.Service
      $svc.Connect()
      $task = $svc.GetFolder('\').GetTask($TaskName)
      $sd = $task.GetSecurityDescriptor(4)
      if ($sd -notmatch [regex]::Escape($sid)) { $task.SetSecurityDescriptor($sd + "(A;;GRGX;;;$sid)", 0) }
    } catch { Write-Warning "Could not let $($cred.UserName) start the task without administrator rights: $($_.Exception.Message)" }
    # Canon's icon: in the Start menu, and when someone signs in
    . (Join-Path $PSScriptRoot 'canon-icon.ps1')
    $ico = Join-Path $Root 'data\run\canon.ico'
    New-Item -ItemType Directory -Force (Split-Path $ico) | Out-Null
    Save-CanonIco $ico
    $shell = New-Object -ComObject WScript.Shell
    foreach ($lnk in $Shortcuts) {
      $s = $shell.CreateShortcut($lnk)
      $s.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
      $s.Arguments = "-STA -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Tray`""
      $s.WorkingDirectory = $Root
      $s.WindowStyle = 7
      $s.IconLocation = $ico
      $s.Description = 'Canon: shows that Canon is running and its address; starts it if needed'
      $s.Save()
    }
    Stop-Canon
    Start-ScheduledTask -TaskName $TaskName
    # the icon, as the signed-in user (not as administrator)
    if (-not (Get-TrayProcess)) { Start-Process explorer.exe -ArgumentList "`"$($Shortcuts[0])`"" }
    Write-Host "Installed. Canon now starts with Windows, as $($cred.UserName), on port $(Get-Port)."
    Write-Host 'Its icon is in the notification area (by the clock; under ^ until you choose to show it).'
    Write-Host 'Close any Canon window that is still open; the task runs Canon from now on.'
  }
  'uninstall' {
    if (-not (Test-Admin)) { throw 'Run this as administrator.' }
    Stop-Canon
    if (Get-CanonTask) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
    Get-TrayProcess | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    foreach ($lnk in $Shortcuts) { Remove-Item $lnk -Force -ErrorAction SilentlyContinue }
    Write-Host 'Removed. Start Canon with start-canon.bat again.'
  }
  'start' {
    if (-not (Get-CanonTask)) { throw 'The Canon task is not installed (install first).' }
    Start-ScheduledTask -TaskName $TaskName
    Write-Host 'Starting.'
  }
  'stop' {
    Stop-Canon
    if (Get-CanonTask) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
    Write-Host 'Stopped.'
  }
  'restart' {
    if (-not (Get-CanonTask)) { throw 'The Canon task is not installed (install first).' }
    Stop-Canon
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName $TaskName
    Write-Host 'Restarting (an update is installed and built first, as in start-canon.bat).'
  }
  'status' {
    $t = Get-CanonTask
    $port = Get-Port
    if ($t) {
      $info = Get-ScheduledTaskInfo -TaskName $TaskName
      Write-Host "Task: installed ($($t.State)), runs as $($t.Principal.UserId); last run $($info.LastRunTime), result $($info.LastTaskResult)."
    } else {
      Write-Host 'Task: not installed (Canon runs from start-canon.bat).'
    }
    Write-Host ("Canon on port ${port}: " + $(if (Test-Listening) { 'running' } else { 'not running' }))
    Write-Host ('Tray icon: ' + $(if (Get-TrayProcess) { 'shown' } else { 'not running' }))
  }
}
