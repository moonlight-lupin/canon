# What scripts\windows-task.ps1 and scripts\canon-tray.ps1 both need to know about this Canon: its port and where
# its stop token is. Read the way start-canon.bat reads them: canon.local.bat's settings, else the defaults.

# a "set NAME=value" line in canon.local.bat (the last one wins, as in the batch file; REM lines don't count)
function Get-LocalSetting([string]$Root, [string]$Name) {
  $local = Join-Path $Root 'canon.local.bat'
  if (-not (Test-Path $local)) { return $null }
  $m = Select-String -Path $local -Pattern "^\s*set\s+`"?$Name=([^`"\r\n]*)" | Select-Object -Last 1
  if ($m) { return $m.Matches[0].Groups[1].Value.Trim() }
  return $null
}

# the port Canon listens on: canon.local.bat's CANON_PORT, else the computer's CANON_PORT, else 3000
function Get-CanonPort([string]$Root) {
  $p = Get-LocalSetting $Root 'CANON_PORT'
  if (-not $p) { $p = $env:CANON_PORT }
  if ($p -match '^\d+$') { return [int]$p }
  return 3000
}

# the stop token Canon writes at start-up: run\control-<port>.json next to its database (data\ by default)
function Get-ControlFile([string]$Root, [int]$Port) {
  $db = Get-LocalSetting $Root 'CANON_DB'
  if (-not $db) { $db = $env:CANON_DB }
  if (-not $db) { $db = 'data\canon.db' }
  # (paths joined as text: the drive may be one this account doesn't see)
  if (-not [IO.Path]::IsPathRooted($db)) { $db = [IO.Path]::Combine($Root, $db) }
  return [IO.Path]::Combine([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($db)), 'run', "control-$Port.json")
}
