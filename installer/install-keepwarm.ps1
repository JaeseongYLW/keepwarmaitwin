<# : batch portion
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; iex ([IO.File]::ReadAllText($f, [Text.Encoding]::UTF8))"
echo.
pause
exit /b
#>
# ---- 여기부터 PowerShell ----
$ErrorActionPreference = 'Stop'
$PluginZip = '__PLUGIN_ZIP_BASE64__'
$Name = 'keepwarm'

Write-Host ''
Write-Host '=== keepwarm 설치/업데이트 ===' -ForegroundColor Cyan

# 1) Claude Code 확인
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host 'Claude Code(claude 명령)를 찾지 못했습니다. Claude Code를 먼저 설치해 주세요.' -ForegroundColor Red
  exit 1
}

# 2) 모드 파일 교체 (이전 버전은 지우고 새로 풂, 설정값은 settings.json에 있어 유지됨)
$claudeDir = Join-Path $env:USERPROFILE '.claude'
$modDir = Join-Path $claudeDir "mods\$Name"
$isUpdate = Test-Path $modDir
if ($isUpdate) { Remove-Item -Recurse -Force $modDir }
New-Item -ItemType Directory -Force -Path $modDir | Out-Null
$zipPath = Join-Path $env:TEMP "$Name-install.zip"
[IO.File]::WriteAllBytes($zipPath, [Convert]::FromBase64String($PluginZip))
Expand-Archive -Path $zipPath -DestinationPath $modDir -Force
Remove-Item $zipPath -Force
$ver = ([IO.File]::ReadAllText((Join-Path $modDir '.claude-plugin\plugin.json')) | ConvertFrom-Json).version
Write-Host "모드 설치: $modDir (버전 $ver)"

# 3) settings.json에 모드 경로 등록 (이미 있으면 그대로)
$settingsPath = Join-Path $claudeDir 'settings.json'
$settings = New-Object PSObject
if (Test-Path $settingsPath) {
  $raw = [IO.File]::ReadAllText($settingsPath, [Text.Encoding]::UTF8)
  if ($raw.Trim()) { $settings = $raw | ConvertFrom-Json }
}
if (-not ($settings.PSObject.Properties.Name -contains 'env') -or $null -eq $settings.env) {
  $settings | Add-Member -NotePropertyName 'env' -NotePropertyValue (New-Object PSObject) -Force
}
$dirs = @()
if ($settings.env.PSObject.Properties.Name -contains 'CLAUDE_CODE_PLUGIN_DIRS' -and $settings.env.CLAUDE_CODE_PLUGIN_DIRS) {
  $dirs = @($settings.env.CLAUDE_CODE_PLUGIN_DIRS -split ';' | Where-Object { $_ })
}
$has = @($dirs | Where-Object { $_.TrimEnd('\') -eq $modDir.TrimEnd('\') -or $_ -eq '~/.claude/mods/keepwarm' -or $_ -eq '~\.claude\mods\keepwarm' }).Count -gt 0
if (-not $has) {
  if (Test-Path $settingsPath) { Copy-Item $settingsPath "$settingsPath.bak-$(Get-Date -Format yyyyMMddHHmmss)" }
  $dirs += $modDir
  $settings.env | Add-Member -NotePropertyName 'CLAUDE_CODE_PLUGIN_DIRS' -NotePropertyValue ($dirs -join ';') -Force
  New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null
  [IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 32), (New-Object Text.UTF8Encoding $false))
  Write-Host "설정 반영: $settingsPath (기존 파일은 .bak 으로 백업)"
} else {
  Write-Host '설정: 이미 등록되어 있어 바꾸지 않았습니다.'
}

Write-Host ''
if ($isUpdate) { Write-Host '업데이트가 끝났습니다.' -ForegroundColor Green } else { Write-Host '설치가 끝났습니다.' -ForegroundColor Green }
Write-Host '열려 있는 Claude Code를 모두 종료하고 다시 실행하세요. /keepwarm 으로 상태를 볼 수 있습니다.'
