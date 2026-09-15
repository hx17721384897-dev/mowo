param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'status')]
  [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$RunDir = Join-Path $RepoRoot '.local-run'
$ApiPidFile = Join-Path $RunDir 'api.pid'
$WebPidFile = Join-Path $RunDir 'web.pid'

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
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch {}
    Start-Sleep -Milliseconds 250
  }
  throw "Service did not become ready: $Url"
}

function Save-OwnedProcess([System.Diagnostics.Process]$Process, [string]$PidFile, [string]$ExpectedScript, [string]$ExecutablePath) {
  $record = [ordered]@{
    pid = $Process.Id
    startTimeUtcTicks = $Process.StartTime.ToUniversalTime().Ticks
    executablePath = [System.IO.Path]::GetFullPath($ExecutablePath)
    expectedScript = $ExpectedScript
  }
  $record | ConvertTo-Json | Set-Content -LiteralPath $PidFile
}

function Get-OwnedProcess([string]$PidFile) {
  if (-not (Test-Path -LiteralPath $PidFile)) { return }
  try {
    $record = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
    $process = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
  } catch {
    throw "Process record is invalid; inspect it before removing: $PidFile"
  }
  if (-not $process) { return }
  # Windows PowerShell 5 can return a null Process.Path immediately after
  # Start-Process. Older pid records therefore fall back to the current Node
  # executable, while start time still protects against PID reuse.
  $expectedExecutablePath = if ($record.executablePath) {
    [System.IO.Path]::GetFullPath([string]$record.executablePath)
  } else {
    [System.IO.Path]::GetFullPath((Get-Command node).Source)
  }
  $actualExecutablePath = [System.IO.Path]::GetFullPath($process.Path)
  $sameExecutable = [string]::Equals($actualExecutablePath, $expectedExecutablePath, [System.StringComparison]::OrdinalIgnoreCase)
  if ($process.StartTime.ToUniversalTime().Ticks -ne [long]$record.startTimeUtcTicks -or -not $sameExecutable) {
    throw "Refusing to operate on PID $($record.pid): process identity does not match the saved record"
  }
  return $process
}

function Stop-OwnedProcess([string]$PidFile) {
  $process = Get-OwnedProcess $PidFile
  if ($process) { Stop-Process -Id $process.Id -Force }
  Remove-Item -LiteralPath $PidFile -Force
}

if ($Action -eq 'status') {
  Write-Host "API 3001: $(if (Test-Listening 3001) { 'running' } else { 'stopped' })"
  Write-Host "Web 5500: $(if (Test-Listening 5500) { 'running' } else { 'stopped' })"
  exit 0
}

if ($Action -eq 'stop') {
  Stop-OwnedProcess $WebPidFile
  Stop-OwnedProcess $ApiPidFile
  Write-Host 'Stopped local services owned by scripts/local.ps1.'
  exit 0
}

New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
if (Test-Listening 3001) { throw 'Port 3001 is already in use; inspect the existing API before starting another one.' }
if (Test-Listening 5500) { throw 'Port 5500 is already in use; inspect the existing web service before starting another one.' }

$dbLine = Get-Content (Join-Path $RepoRoot 'content-service/.env') | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $dbLine) { throw 'content-service/.env is missing DATABASE_URL.' }
$env:DATABASE_URL = (($dbLine -replace '^DATABASE_URL=', '').Trim('"')) -replace '/mowo_db([?\"]|$)', '/mowo_b1_test$1'
if ($env:DATABASE_URL -notmatch '/mowo_b1_test(?:\?|$)') { throw 'Could not safely derive the mowo_b1_test database URL.' }

$node = (Get-Command node).Source
$api = Start-Process -FilePath $node -ArgumentList 'src/index.js' -WorkingDirectory (Join-Path $RepoRoot 'content-service') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $RunDir 'api.out.log') -RedirectStandardError (Join-Path $RunDir 'api.err.log')
Save-OwnedProcess $api $ApiPidFile 'src/index.js' $node

$webArgs = @((Join-Path $RepoRoot 'scripts/static-server.mjs'), '--root=frontend', '--mount=mowo/frontend', '--port=5500')
$web = Start-Process -FilePath $node -ArgumentList $webArgs -WorkingDirectory $RepoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $RunDir 'web.out.log') -RedirectStandardError (Join-Path $RunDir 'web.err.log')
Save-OwnedProcess $web $WebPidFile 'static-server.mjs' $node

try {
  Wait-Url 'http://127.0.0.1:3001/'
  Wait-Url 'http://127.0.0.1:5500/mowo/frontend/pages/index.html'
} catch {
  & $PSCommandPath stop
  throw
}

Write-Host 'Local services started (database: mowo_b1_test):'
Write-Host '  Legacy web: http://127.0.0.1:5500/mowo/frontend/pages/index.html'
Write-Host '  API: http://127.0.0.1:3001/'
Write-Host 'Stop command: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/local.ps1 stop'
