$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiRoot = Join-Path $repoRoot "apps\api"
$webRoot = Join-Path $repoRoot "apps\web"
$apiEnv = Join-Path $apiRoot ".env"
$webEnv = Join-Path $webRoot ".env"

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $Name. Install Node.js 18.18+ first."
    }
}

function Wait-Http([string]$Url, [int]$Attempts = 40) {
    for ($i = 0; $i -lt $Attempts; $i++) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    return $false
}

Set-Location $repoRoot
Assert-Command "node"
Assert-Command "npm.cmd"

$nodeVersion = (& node -p "process.versions.node").Trim()
Write-Host "AIVio Local Mode" -ForegroundColor Cyan
Write-Host "Node.js $nodeVersion"

if (-not (Test-Path $apiEnv)) {
    Copy-Item (Join-Path $apiRoot ".env.example") $apiEnv
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
    (Get-Content $apiEnv -Raw).Replace("your_jwt_secret_here", $secret) | Set-Content $apiEnv -Encoding UTF8
    Write-Host "Created apps/api/.env for local development." -ForegroundColor Green
    Write-Host "Add provider API keys to apps/api/.env for real model calls." -ForegroundColor Yellow
}

if (-not (Test-Path $webEnv)) {
    Copy-Item (Join-Path $webRoot ".env.example") $webEnv
    Write-Host "Created apps/web/.env for the local API." -ForegroundColor Green
}

$dependencyMarkers = @(
    (Join-Path $repoRoot "node_modules\react\package.json"),
    (Join-Path $repoRoot "node_modules\express\package.json"),
    (Join-Path $repoRoot "node_modules\typescript\package.json"),
    (Join-Path $repoRoot "node_modules\prisma\build\index.js"),
    (Join-Path $repoRoot "node_modules\@prisma\client\package.json")
)
$dependenciesReady = ($dependencyMarkers | Where-Object { -not (Test-Path $_) }).Count -eq 0
if (-not $dependenciesReady) {
    Write-Host "Installing workspace dependencies..." -ForegroundColor Yellow
    & npm.cmd install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "Workspace dependency installation failed." }
}

Write-Host "Building shared contracts..." -ForegroundColor Yellow
& npm.cmd run contracts:build
if ($LASTEXITCODE -ne 0) { throw "Shared contract build failed." }

Write-Host "Preparing local SQLite database..." -ForegroundColor Yellow
& npm.cmd run db:generate
if ($LASTEXITCODE -ne 0) { throw "Prisma generate failed." }
& npm.cmd run db:push
if ($LASTEXITCODE -ne 0) { throw "Prisma db push failed." }
& npm.cmd run models:sync
if ($LASTEXITCODE -ne 0) { throw "Model config sync failed." }

$apiCommand = "Set-Location '$repoRoot'; npm.cmd run api:dev"
$webCommand = "Set-Location '$repoRoot'; npm.cmd run web:dev"

Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-Command", $apiCommand
if (-not (Wait-Http "http://127.0.0.1:8788/api/health")) {
    throw "Local API did not become ready at http://127.0.0.1:8788/api/health. Check the API window for the exact error."
}

Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-Command", $webCommand
if (-not (Wait-Http "http://127.0.0.1:5173")) {
    throw "Local web app did not become ready at http://127.0.0.1:5173. Check the Web window for the exact error."
}

Write-Host ""
Write-Host "AIVio is running locally:" -ForegroundColor Green
Write-Host "Web: http://127.0.0.1:5173" -ForegroundColor Cyan
Write-Host "API: http://127.0.0.1:8788/api" -ForegroundColor Cyan
Write-Host "SQLite: apps/api/prisma/dev.db" -ForegroundColor Cyan
Start-Process "http://127.0.0.1:5173"
