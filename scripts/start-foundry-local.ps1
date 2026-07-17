# Start Foundry as a real local HTTP service with RSA-PSS evidence signing.
# Windows PowerShell 5.1 compatible. Preserves data; refuses to print secrets.
#
#   powershell -File scripts\start-foundry-local.ps1 -Port 4319
#
# Generates a local-development RSA keypair under .secrets\ (gitignored) if none
# exists. The private key never leaves this repo's .secrets\ and is never printed.

param(
  [int]$Port = 4319,
  [string]$KeyId = "foundry-eve-proof-rsa",
  [string]$KeyVersion = "v1"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$secretsDir = Join-Path $root ".secrets"
if (-not (Test-Path $secretsDir)) { New-Item -ItemType Directory -Path $secretsDir | Out-Null }
$privPath = Join-Path $secretsDir "foundry-evidence-private.pem"
$pubPath  = Join-Path $secretsDir "foundry-evidence-public.pem"

if (-not (Test-Path $privPath)) {
  Write-Host "[foundry] generating local-dev RSA keypair (.secrets\, gitignored)"
  node -e "const {generateKeyPairSync}=require('crypto');const fs=require('fs');const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});fs.writeFileSync(process.argv[1],privateKey.export({type:'pkcs8',format:'pem'}));fs.writeFileSync(process.argv[2],publicKey.export({type:'spki',format:'pem'}));" "$privPath" "$pubPath"
}
$fp = node -e "const c=require('crypto'),fs=require('fs');console.log('sha256:'+c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex').slice(0,32));" "$pubPath"
Write-Host "[foundry] evidence public-key fingerprint $fp (key id $KeyId $KeyVersion)"

if (-not $env:FOUNDRY_MASTER_KEY) {
  $env:FOUNDRY_MASTER_KEY = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
}
$env:FOUNDRY_PERSISTENCE = "file"
$env:FOUNDRY_EVIDENCE_SIGNER_PROVIDER = "local-kms-rsa"
$env:FOUNDRY_EVIDENCE_KMS_PRIVATE_KEY_PEM = [IO.File]::ReadAllText($privPath)
$env:FOUNDRY_EVIDENCE_SIGNING_KEY_ID = $KeyId
$env:FOUNDRY_EVIDENCE_SIGNING_KEY_VERSION = $KeyVersion

# Refuse duplicate server on the port.
$inUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($inUse) { Write-Host "[foundry] port $Port already in use (PID $($inUse.OwningProcess)) - reusing"; exit 0 }

Write-Host "[foundry] starting on http://127.0.0.1:$Port (persistence=file, signing=RSA-PSS)"
$nextBin = Join-Path $root "node_modules\next\dist\bin\next"
$proc = Start-Process -FilePath "node" -ArgumentList @($nextBin,"dev","-p","$Port") -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $root ".foundry-data\dev.out.log") -RedirectStandardError (Join-Path $root ".foundry-data\dev.err.log")
Set-Content -Path (Join-Path $secretsDir "foundry.pid") -Value $proc.Id -Encoding ascii

# Wait for health readiness.
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 750
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/healthz" -TimeoutSec 4
    if ($r.status -eq "ok") { $ok = $true; break }
  } catch {}
}
if (-not $ok) { Write-Error "[foundry] health did not become ready on port $Port"; exit 1 }
Write-Host "[foundry] READY http://127.0.0.1:$Port (PID $($proc.Id))"
exit 0
