<# : batch portion
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; iex ([IO.File]::ReadAllText($f, [Text.Encoding]::UTF8))"
echo.
pause
exit /b
#>
# codemode-ab uninstall: removes the scheduled task, the mod folder and its settings entries.
$claudeDir = Join-Path $env:USERPROFILE '.claude'
$modDir = Join-Path $claudeDir 'mods\codemode-ab'
try { Unregister-ScheduledTask -TaskName 'codemode-ab-daily' -Confirm:$false -ErrorAction Stop; Write-Host 'Scheduled task removed' } catch { & schtasks /Delete /TN codemode-ab-daily /F 2>$null | Out-Null }
$settingsPath = Join-Path $claudeDir 'settings.json'
if (Test-Path $settingsPath) {
  Copy-Item $settingsPath "$settingsPath.bak-$(Get-Date -Format yyyyMMddHHmmss)"
  $s = [IO.File]::ReadAllText($settingsPath) | ConvertFrom-Json
  if ($s.env) {
    $s.env.PSObject.Properties.Remove('CLAUDE_CODE_EXPERIMENTAL_CODE_MODE')
    if ($s.env.CLAUDE_CODE_PLUGIN_DIRS) {
      $left = @($s.env.CLAUDE_CODE_PLUGIN_DIRS -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $modDir.TrimEnd('\')) })
      if ($left.Count -gt 0) { $s.env.CLAUDE_CODE_PLUGIN_DIRS = ($left -join ';') } else { $s.env.PSObject.Properties.Remove('CLAUDE_CODE_PLUGIN_DIRS') }
    }
  }
  if ($s.pluginConfigs) { $s.pluginConfigs.PSObject.Properties.Remove('codemode-ab') }
  [IO.File]::WriteAllText($settingsPath, ($s | ConvertTo-Json -Depth 32), (New-Object Text.UTF8Encoding $false))
  Write-Host 'settings.json cleaned (backup saved)'
}
$abDir = Join-Path $claudeDir 'codemode-ab'
if (Test-Path $abDir) { Remove-Item -Recurse -Force $abDir }
Set-Location $env:USERPROFILE
if (Test-Path $modDir) { Remove-Item -Recurse -Force $modDir }
Write-Host 'codemode-ab removed. Restart Claude Code.'
