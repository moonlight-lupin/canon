# Canon's icon in the Windows notification area (0.18.0): shows whether Canon is running and the address other
# computers use. Click it to open Canon; right-click for the menu, where Exit stops Canon properly (running requests
# finish, the database is closed) and closes the icon. It starts Canon if it isn't running and the Windows task is
# installed. scripts\windows-task.ps1 install puts it in the Start menu ("Canon") and starts it when someone signs in.
#
#   powershell -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File scripts\canon-tray.ps1   [-Port 3000]
param([int]$Port = 0)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

# the port: canon.local.bat's CANON_PORT, else 3000 (as start-canon.bat)
$local = Join-Path $Root 'canon.local.bat'
if (-not $Port) { $Port = 3000 }
if (-not $PSBoundParameters.ContainsKey('Port') -and (Test-Path $local)) {
  $m = Select-String -Path $local -Pattern 'CANON_PORT=(\d+)' | Select-Object -First 1
  if ($m) { $Port = [int]$m.Matches[0].Groups[1].Value }
}

# with -Port (trying the icon against a test Canon) it doesn't start Canon: start-canon.bat would use canon.local.bat's port
$CanStart = -not $PSBoundParameters.ContainsKey('Port')

# one icon per Canon
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\CanonTray-$Port", [ref]$created)
if (-not $created) { exit 0 }

. (Join-Path $PSScriptRoot 'canon-icon.ps1')
$IconOn = New-CanonIcon '#2e9d55'
$IconOff = New-CanonIcon '#8a8f98'

# this computer's address on the office network, by the same rules as start-canon.bat
function Get-LanAddress {
  try { $ip = (& node scripts\lan-address.mjs 2>$null | Select-Object -First 1) } catch { $ip = $null }
  if ($ip) { return "$ip".Trim() } else { return $env:COMPUTERNAME }
}

# Canon's version if it answers, else $null
function Get-Running {
  try {
    $req = [System.Net.WebRequest]::Create("http://127.0.0.1:$Port/api/about")
    $req.Timeout = 1500
    $resp = $req.GetResponse()
    $body = (New-Object System.IO.StreamReader $resp.GetResponseStream()).ReadToEnd()
    $resp.Close()
    return ($body | ConvertFrom-Json).version
  } catch { return $null }
}

function Test-Task { [bool](Get-ScheduledTask -TaskName 'Canon' -ErrorAction SilentlyContinue) }

function Start-Canon {
  if (Test-Task) {
    try { Start-ScheduledTask -TaskName 'Canon'; return } catch { }
  }
  # no task (or this account may not run it): Canon in its window, as when start-canon.bat is double-clicked
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'start-canon.bat' -WorkingDirectory $Root -WindowStyle Minimized
}

$script:version = $null
$script:address = Get-LanAddress
$script:starting = $false
$script:startedAt = [DateTime]::MinValue

$tray = New-Object System.Windows.Forms.NotifyIcon
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miStatus = $menu.Items.Add('Canon')
$miStatus.Enabled = $false
$miAddress = $menu.Items.Add('')
$miAddress.ToolTipText = 'Click to copy the address'
$miOpen = $menu.Items.Add('Open Canon')
$miOpen.Font = New-Object System.Drawing.Font($miOpen.Font, [System.Drawing.FontStyle]::Bold)
[void]$menu.Items.Add('-')
$miStart = $menu.Items.Add('Start Canon')
$miExit = $menu.Items.Add('Exit')
$tray.ContextMenuStrip = $menu

function Update-Tray {
  $script:version = Get-Running
  # a start that hasn't answered in two minutes has failed (see data\logs)
  if ($script:starting -and ([DateTime]::Now - $script:startedAt).TotalMinutes -gt 2) { $script:starting = $false }
  $url = "http://$($script:address):$Port"
  if ($script:version) {
    $script:starting = $false
    $tray.Icon = $IconOn
    $miStatus.Text = "Canon is running (version $($script:version))"
    $text = "Canon is running`n$url"
  } else {
    $tray.Icon = $IconOff
    $miStatus.Text = $(if ($script:starting) { 'Canon is starting...' } else { 'Canon is not running' })
    $text = $miStatus.Text
  }
  # the tooltip holds 63 characters at most
  $tray.Text = $text.Substring(0, [Math]::Min(63, $text.Length))
  $miAddress.Text = "Other computers: $url  (copy)"
  $miAddress.Visible = [bool]$script:version
  $miOpen.Enabled = [bool]$script:version
  $miStart.Visible = $CanStart -and -not $script:version -and -not $script:starting
}

$open = { if ($script:version) { Start-Process "http://localhost:$Port" } }
$tray.add_MouseClick({ param($s, $e) if ($e.Button -eq 'Left') { & $open } })
$miOpen.add_Click($open)
$miAddress.add_Click({
  [System.Windows.Forms.Clipboard]::SetText("http://$($script:address):$Port")
  $tray.ShowBalloonTip(3000, 'Canon', "Copied: http://$($script:address):$Port", 'Info')
})
$miStart.add_Click({ $script:starting = $true; $script:startedAt = [DateTime]::Now; Start-Canon; Update-Tray })
$miExit.add_Click({
  if ($script:version) {
    $answer = [System.Windows.Forms.MessageBox]::Show(
      "Stop Canon?`n`nNobody can use Canon, on this computer or the network, until it is started again: restart the computer, or open Canon from the Start menu.",
      'Canon', 'YesNo', 'Question', 'Button2')
    if ($answer -ne 'Yes') { return }
    $file = Join-Path $Root "data\run\control-$Port.json"
    try {
      $token = (Get-Content $file -Raw | ConvertFrom-Json).token
      $req = [System.Net.WebRequest]::Create("http://127.0.0.1:$Port/control/stop")
      $req.Method = 'POST'
      $req.Headers.Add('X-Canon-Control', $token)
      $req.ContentLength = 0
      $req.Timeout = 5000
      $req.GetResponse().Close()
    } catch {
      [System.Windows.Forms.MessageBox]::Show("This icon could not stop Canon (it may be running as another Windows account).`n`n$($_.Exception.Message)", 'Canon', 'OK', 'Warning') | Out-Null
      return
    }
    # wait (up to 15 seconds) until it has stopped
    $tray.Text = 'Canon is stopping...'
    for ($i = 0; $i -lt 30 -and (Get-Running); $i++) { Start-Sleep -Milliseconds 500 }
  }
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({
  # the address can change (a new network, DHCP): look again every minute
  if ((++$script:tickCount % 12) -eq 0) { $script:address = Get-LanAddress }
  Update-Tray
})
$script:tickCount = 0

# Canon starts with Windows (the task); if it isn't running, start it now
if ($CanStart -and -not (Get-Running) -and (Test-Task)) { $script:starting = $true; $script:startedAt = [DateTime]::Now; Start-Canon }
Update-Tray
$tray.Visible = $true
$timer.Start()
[System.Windows.Forms.Application]::Run()
$timer.Stop()
$tray.Dispose()
$mutex.ReleaseMutex()
