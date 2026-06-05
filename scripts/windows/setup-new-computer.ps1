$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root

function Assert-Command($Name, $InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "Missing required tool: $Name" -ForegroundColor Red
    Write-Host $InstallHint -ForegroundColor Yellow
    throw "Please install $Name, then run this file again."
  }
}

Write-Host "Setting up Personal Ledger PWA on this computer..." -ForegroundColor Cyan
Assert-Command "git" "Install Git for Windows: https://git-scm.com/download/win"
Assert-Command "node" "Install Node.js LTS: https://nodejs.org/"
Assert-Command "npm" "Node.js LTS includes npm."

if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example. Keep real secrets out of GitHub." -ForegroundColor Yellow
}

npm install
npm run typecheck

Write-Host ""
Write-Host "Ready. Use start-local-preview.cmd for local preview, publish-to-github.cmd to publish code, and deploy-server.cmd to update the cloud server." -ForegroundColor Green
