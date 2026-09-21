$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ServiceRoot = Join-Path $RepoRoot 'content-service'
$RunDir = Join-Path $RepoRoot '.local-run'
$ApiProcess = $null
$WebProcess = $null

function Test-Listening([int]$Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.ConnectAsync('127.0.0.1', $Port)
    return $connect.Wait(500) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Wait-Url([string]$Url) {
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch {}
    Start-Sleep -Milliseconds 250
  }
  throw "Service did not become ready: $Url"
}

function Start-TestApi([string]$Phase) {
  $process = Start-Process -FilePath $node -ArgumentList 'src/index.js' -WorkingDirectory $ServiceRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $RunDir "b7-api-$Phase.out.log") -RedirectStandardError (Join-Path $RunDir "b7-api-$Phase.err.log")
  Wait-Url 'http://127.0.0.1:3002/'
  return $process
}

function Invoke-Checks([string[]]$Checks) {
  foreach ($check in $Checks) {
    Write-Host "`n=== $check ===" -ForegroundColor Cyan
    & npm.cmd run $check
    if ($LASTEXITCODE -ne 0) { throw "Regression check failed: $check" }
  }
}

if (Test-Listening 3002) { throw 'Isolated test port 3002 is already in use.' }
if (Test-Listening 5500) { throw 'Browser test port 5500 is already in use.' }

$dbLine = Get-Content (Join-Path $ServiceRoot '.env') | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $dbLine) { throw 'content-service/.env is missing DATABASE_URL.' }
$originalDatabaseUrl = $env:DATABASE_URL
$originalPort = $env:PORT
$originalApiBase = $env:TEST_API_BASE
$originalOnlineCheckout = $env:ONLINE_CHECKOUT_ENABLED
$originalMockPayment = $env:MOCK_PAYMENT_ENABLED
$env:DATABASE_URL = (($dbLine -replace '^DATABASE_URL=', '').Trim('"')) -replace '/mowo_db([?\"]|$)', '/mowo_b1_test$1'
if ($env:DATABASE_URL -notmatch '/mowo_b1_test(?:\?|$)') { throw 'Could not safely construct the mowo_b1_test database URL.' }
$env:PORT = '3002'
$env:TEST_API_BASE = 'http://127.0.0.1:3002'
$env:ONLINE_CHECKOUT_ENABLED = 'false'
$env:MOCK_PAYMENT_ENABLED = 'false'

New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

try {
  Push-Location $ServiceRoot
  & node scripts/test-database.mjs rebuild
  if ($LASTEXITCODE -ne 0) { throw 'Isolated test database rebuild failed.' }

  $node = (Get-Command node).Source
  $ApiProcess = Start-TestApi 'closed'
  $webArgs = @((Join-Path $RepoRoot 'scripts/static-server.mjs'), '--root=frontend', '--mount=mowo/frontend', '--port=5500')
  $WebProcess = Start-Process -FilePath $node -ArgumentList $webArgs -WorkingDirectory $RepoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $RunDir 'b7-web.out.log') -RedirectStandardError (Join-Path $RunDir 'b7-web.err.log')

  Wait-Url 'http://127.0.0.1:5500/mowo/frontend/pages/index.html'

  Invoke-Checks @(
    'check',
    'check:admin-runtime-config',
    'check:legacy-production-boundary',
    'check:feature-gates',
    'check:retired-endpoints',
    'check:staff-security',
    'check:launch-safety',
    'check:admin-role-browser',
    'check:user-shell-browser'
  )

  Stop-Process -Id $ApiProcess.Id -Force
  Wait-Process -Id $ApiProcess.Id -ErrorAction SilentlyContinue
  $env:ONLINE_CHECKOUT_ENABLED = 'true'
  $env:MOCK_PAYMENT_ENABLED = 'true'
  $ApiProcess = Start-TestApi 'workflow'

  Invoke-Checks @(
    'check:private-files',
    'check:account-deletion',
    'check:settings-ui',
    'check:customization-flow',
    'check:customization-ui',
    'check:sales-order-structure',
    'check:mixed-checkout-ui',
    'check:standard-kit-inventory',
    'check:inventory-traceability',
    'check:production-batches',
    'check:print-production',
    'check:frame-library',
    'check:frame-making',
    'check:frame-imports',
    'check:production-artifacts',
    'check:production-workflow',
    'check:production-scan-safety',
    'check:production-scan-ui',
    'check:collab-storefront',
    'check:collab-sale-config',
    'check:collab-product-ui'
  )
} finally {
  Pop-Location -ErrorAction SilentlyContinue
  if ($WebProcess -and -not $WebProcess.HasExited) { Stop-Process -Id $WebProcess.Id -Force }
  if ($ApiProcess -and -not $ApiProcess.HasExited) { Stop-Process -Id $ApiProcess.Id -Force }
}

Push-Location (Join-Path $RepoRoot 'frontend-vue')
try {
  & npm.cmd run check
  if ($LASTEXITCODE -ne 0) { throw 'Vue full quality gate failed.' }
} finally {
  Pop-Location
}

Push-Location $ServiceRoot
try {
  & node scripts/check-backup-restore.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Backup restore drill failed.' }
  Write-Host "`nB7 full regression and backup restore drill passed." -ForegroundColor Green
} finally {
  Pop-Location
  $env:DATABASE_URL = $originalDatabaseUrl
  $env:PORT = $originalPort
  $env:TEST_API_BASE = $originalApiBase
  $env:ONLINE_CHECKOUT_ENABLED = $originalOnlineCheckout
  $env:MOCK_PAYMENT_ENABLED = $originalMockPayment
}
