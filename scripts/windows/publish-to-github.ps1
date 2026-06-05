$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git is not installed. Run setup-new-computer.cmd first."
}

if (-not (Test-Path "node_modules")) {
  npm install
}

Write-Host "Checking and building before publish..." -ForegroundColor Cyan
npm run typecheck
npm run build

$status = git status --short
if (-not $status) {
  Write-Host "No code changes to publish." -ForegroundColor Green
  exit 0
}

Write-Host ""
Write-Host "Changed files:" -ForegroundColor Cyan
$status | ForEach-Object { Write-Host $_ }
Write-Host ""

$message = Read-Host "Commit message"
if ([string]::IsNullOrWhiteSpace($message)) {
  $message = "Update ledger app"
}

git add README.md apps packages deploy docs docker-compose.yml docker-compose.build.yml package.json package-lock.json .github .env.example 2>$null
git commit -m $message
git push origin main

Write-Host ""
Write-Host "Published to GitHub. Wait for GitHub Actions to finish, then run deploy-server.cmd." -ForegroundColor Green
