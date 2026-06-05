$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies first..." -ForegroundColor Cyan
  npm install
}

Write-Host "Starting local preview at http://127.0.0.1:4283/" -ForegroundColor Cyan
Write-Host "Close this window to stop the preview." -ForegroundColor Yellow
Start-Process "http://127.0.0.1:4283/"
npm --workspace @ledger/web run preview -- --host 127.0.0.1 --port 4283
