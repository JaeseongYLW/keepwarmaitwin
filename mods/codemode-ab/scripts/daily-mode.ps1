# codemode-ab: pick today's Code Mode (on/off, 50:50) once per day and write it to
# ~/.claude/settings.json (env.CLAUDE_CODE_EXPERIMENTAL_CODE_MODE).
# Run by the scheduled task "codemode-ab-daily" (daily 06:00 and at logon).
$ErrorActionPreference = 'Stop'
$claudeDir = Join-Path $env:USERPROFILE '.claude'
$abDir = Join-Path $claudeDir 'codemode-ab'
New-Item -ItemType Directory -Force -Path $abDir | Out-Null
$assignPath = Join-Path $abDir 'assignment.json'
$logPath = Join-Path $abDir 'daily-mode.log'
$today = (Get-Date).ToString('yyyy-MM-dd')

$mode = $null
if (Test-Path $assignPath) {
  try {
    $a = [IO.File]::ReadAllText($assignPath) | ConvertFrom-Json
    if ($a.date -eq $today -and ($a.mode -eq 'on' -or $a.mode -eq 'off')) { $mode = $a.mode }
  } catch { }
}
if (-not $mode) {
  if ((Get-Random -Minimum 0 -Maximum 2) -eq 1) { $mode = 'on' } else { $mode = 'off' }
  $json = '{"date":"' + $today + '","mode":"' + $mode + '"}'
  [IO.File]::WriteAllText($assignPath, $json, (New-Object Text.UTF8Encoding $false))
}
$want = '0'
if ($mode -eq 'on') { $want = '1' }

$settingsPath = Join-Path $claudeDir 'settings.json'
$settings = New-Object PSObject
if (Test-Path $settingsPath) {
  $raw = [IO.File]::ReadAllText($settingsPath)
  if ($raw.Trim()) { $settings = $raw | ConvertFrom-Json }
}
if (-not ($settings.PSObject.Properties.Name -contains 'env') -or $null -eq $settings.env) {
  $settings | Add-Member -NotePropertyName 'env' -NotePropertyValue (New-Object PSObject) -Force
}
$current = $null
if ($settings.env.PSObject.Properties.Name -contains 'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE') {
  $current = [string]$settings.env.CLAUDE_CODE_EXPERIMENTAL_CODE_MODE
}
if ($current -ne $want) {
  $settings.env | Add-Member -NotePropertyName 'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE' -NotePropertyValue $want -Force
  [IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 32), (New-Object Text.UTF8Encoding $false))
}
Add-Content -Path $logPath -Value "$(Get-Date -Format o) mode=$mode"
