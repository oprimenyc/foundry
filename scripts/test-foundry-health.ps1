# Probe Foundry health. Exit 0 only when truthfully healthy.
param([int]$Port = 4319)
$ErrorActionPreference = "Stop"
try {
  $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/healthz" -TimeoutSec 5
} catch {
  Write-Error "[foundry] unreachable on port $Port"; exit 1
}
Write-Host "[foundry] status=$($r.status) persistence=$($r.persistence) auth=$($r.auth) planner=$($r.planner) mocks=$($r.mock_providers)"
if ($r.status -ne "ok") { Write-Error "[foundry] not ok"; exit 1 }
exit 0
