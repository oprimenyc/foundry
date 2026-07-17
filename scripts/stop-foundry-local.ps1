# Stop the Foundry local server started by start-foundry-local.ps1 (by PID file).
param()
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".secrets\foundry.pid"
if (Test-Path $pidFile) {
  $foundryPid = Get-Content $pidFile
  if ($foundryPid) {
    Stop-Process -Id ([int]$foundryPid) -Force -ErrorAction SilentlyContinue
    Write-Host "[foundry] stopped PID $foundryPid"
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "[foundry] no PID file; nothing to stop"
}
exit 0
