<# : batch portion
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; iex ([IO.File]::ReadAllText($f, [Text.Encoding]::UTF8))"
echo.
pause
exit /b
#>
# ---- 여기부터 PowerShell ----
$ErrorActionPreference = 'Stop'
$WebhookUrl = '__WEBHOOK_URL__'
$PluginZip = '__PLUGIN_ZIP_BASE64__'
$Name = 'codemode-ab'

Write-Host ''
Write-Host '=== Code Mode 비교 실험 설치 ===' -ForegroundColor Cyan

# 1) Claude Code 확인
$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude) {
  Write-Host 'Claude Code(claude 명령)를 찾지 못했습니다. Claude Code를 먼저 설치해 주세요.' -ForegroundColor Red
  exit 1
}
try { $ver = (& claude --version 2>$null | Select-Object -First 1) } catch { $ver = '' }
Write-Host "Claude Code: $ver"

# 2) 참가자 이름
$participant = ''
while (-not $participant) { $participant = (Read-Host '결과에 표시할 이름을 입력하세요').Trim() }

# 3) 모드 파일 풀기
$claudeDir = Join-Path $env:USERPROFILE '.claude'
$modDir = Join-Path $claudeDir "mods\$Name"
if (Test-Path $modDir) { Remove-Item -Recurse -Force $modDir }
New-Item -ItemType Directory -Force -Path $modDir | Out-Null
$zipPath = Join-Path $env:TEMP "$Name.zip"
[IO.File]::WriteAllBytes($zipPath, [Convert]::FromBase64String($PluginZip))
Expand-Archive -Path $zipPath -DestinationPath $modDir -Force
Remove-Item $zipPath -Force
Write-Host "모드 설치: $modDir"

# 4) settings.json 수정 (백업 후)
$settingsPath = Join-Path $claudeDir 'settings.json'
if (Test-Path $settingsPath) {
  $raw = [IO.File]::ReadAllText($settingsPath, [Text.Encoding]::UTF8)
  Copy-Item $settingsPath "$settingsPath.bak-$(Get-Date -Format yyyyMMddHHmmss)"
  if ($raw.Trim()) { $settings = $raw | ConvertFrom-Json } else { $settings = New-Object PSObject }
} else {
  $settings = New-Object PSObject
}
function Get-Child($obj, $key) {
  if (-not ($obj.PSObject.Properties.Name -contains $key) -or $null -eq $obj.$key) {
    $obj | Add-Member -NotePropertyName $key -NotePropertyValue (New-Object PSObject) -Force
  }
  return $obj.$key
}
$envObj = Get-Child $settings 'env'
$dirs = @()
if ($envObj.PSObject.Properties.Name -contains 'CLAUDE_CODE_PLUGIN_DIRS' -and $envObj.CLAUDE_CODE_PLUGIN_DIRS) {
  $dirs = @($envObj.CLAUDE_CODE_PLUGIN_DIRS -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $modDir.TrimEnd('\')) })
}
$dirs += $modDir
$envObj | Add-Member -NotePropertyName 'CLAUDE_CODE_PLUGIN_DIRS' -NotePropertyValue ($dirs -join ';') -Force

$cfgs = Get-Child $settings 'pluginConfigs'
$mine = Get-Child $cfgs $Name
$opts = Get-Child $mine 'options'
$opts | Add-Member -NotePropertyName 'participant' -NotePropertyValue $participant -Force
$opts | Add-Member -NotePropertyName 'webhookUrl' -NotePropertyValue $WebhookUrl -Force

New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null
$json = $settings | ConvertTo-Json -Depth 32
[IO.File]::WriteAllText($settingsPath, $json, (New-Object Text.UTF8Encoding $false))
Write-Host "설정 반영: $settingsPath (기존 파일은 .bak 으로 백업)"

# 5) 오늘 모드 정하기 + 매일 자동 배정 작업 등록 (매일 06:00, 로그인할 때)
$daily = Join-Path $modDir 'scripts\daily-mode.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $daily
$assign = [IO.File]::ReadAllText((Join-Path $claudeDir 'codemode-ab\assignment.json')) | ConvertFrom-Json
$label = '끔'
if ($assign.mode -eq 'on') { $label = '켬' }
Write-Host "오늘 배정: Code Mode $label"

$taskArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$daily`""
$registered = $false
try {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
  $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $triggers = @(New-ScheduledTaskTrigger -Daily -At '06:00')
  try { $triggers += New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME" } catch { }
  try {
    Register-ScheduledTask -TaskName 'codemode-ab-daily' -Action $action -Trigger $triggers -Settings $set -Force -ErrorAction Stop | Out-Null
  } catch {
    Register-ScheduledTask -TaskName 'codemode-ab-daily' -Action $action -Trigger $triggers[0] -Settings $set -Force -ErrorAction Stop | Out-Null
  }
  $registered = $true
} catch {
  & schtasks /Create /F /SC DAILY /ST 06:00 /TN codemode-ab-daily /TR "powershell.exe $taskArgs" | Out-Null
  if ($LASTEXITCODE -eq 0) { $registered = $true }
}
if ($registered) { Write-Host '매일 자동 배정 작업 등록: codemode-ab-daily' }
else { Write-Host '자동 배정 작업을 등록하지 못했습니다. 담당자에게 알려 주세요.' -ForegroundColor Yellow }

Write-Host ''
Write-Host '설치가 끝났습니다.' -ForegroundColor Green
Write-Host '1. 터미널(Windows Terminal 또는 PowerShell)을 새로 열고 claude 를 실행하세요.'
Write-Host '2. 노란 안내가 보이면 /exit 후 claude 를 한 번 더 실행하세요. (오늘 배정된 모드로 바뀝니다)'
Write-Host '3. /ab-status 로 오늘 배정과 집계를 볼 수 있습니다. 결과는 매일 16:55에 자동 전송됩니다.'
Write-Host "제거: $modDir\scripts\uninstall.cmd 실행"
