$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  throw "OpenSSH client is not available on this computer."
}

$HostName = "47.74.3.104"
$User = "root"
$KeyPath = Join-Path $HOME ".ssh\codex_ledger_deploy"
$RemoteCommand = "cd /root/personal-ledger-pwa && bash deploy/update-server.sh && bash deploy/install-maintenance-cron.sh"

Write-Host "Updating cloud server with lightweight deploy..." -ForegroundColor Cyan
if (Test-Path $KeyPath) {
  ssh -i $KeyPath -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new "$User@$HostName" $RemoteCommand
} else {
  Write-Host "SSH key not found at $KeyPath. Password login will be used if enabled." -ForegroundColor Yellow
  ssh -o StrictHostKeyChecking=accept-new "$User@$HostName" $RemoteCommand
}

Write-Host ""
Write-Host "Checking production health..." -ForegroundColor Cyan
$health = Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 "https://ledger.47.74.3.104.sslip.io/api/health"
Write-Host $health.Content -ForegroundColor Green
Write-Host "Done: https://ledger.47.74.3.104.sslip.io" -ForegroundColor Green
