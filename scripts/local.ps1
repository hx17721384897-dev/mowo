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
  throw "服务未能就绪：$Url"
}

function Save-OwnedProcess([System.Diagnostics.Process]$Process, [string]$PidFile, [string]$ExpectedScript) {
  $record = [ordered]@{
    pid = $Process.Id
    startTimeUtcTicks = $Process.StartTime.ToUniversalTime().Ticks
    executablePath = $Process.Path
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
    throw "进程记录损坏，请人工核对后删除：$PidFile"
  }
  if (-not $process) { return }
  if ($process.StartTime.ToUniversalTime().Ticks -ne [long]$record.startTimeUtcTicks -or $process.Path -ne $record.executablePath) {
    throw "拒绝操作 PID $($record.pid)：进程身份与本脚本记录不匹配"
  }
  return $process
}

function Stop-OwnedProcess([string]$PidFile) {
  $process = Get-OwnedProcess $PidFile
  if ($process) { Stop-Process -Id $process.Id -Force }
  Remove-Item -LiteralPath $PidFile -Force
}

if ($Action -eq 'status') {
  Write-Host "API 3001: $(if (Test-Listening 3001) { '运行中' } else { '未运行' })"
  Write-Host "Web 5500: $(if (Test-Listening 5500) { '运行中' } else { '未运行' })"
  exit 0
}

if ($Action -eq 'stop') {
  Stop-OwnedProcess $WebPidFile
  Stop-OwnedProcess $ApiPidFile
  Write-Host '已停止由 scripts/local.ps1 启动的本地服务。'
  exit 0
}

New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
if (Test-Listening 3001) { throw '端口 3001 已被占用；请先确认现有 API，不要重复启动。' }
if (Test-Listening 5500) { throw '端口 5500 已被占用；请先确认现有前端服务，不要重复启动。' }

$dbLine = Get-Content (Join-Path $RepoRoot 'content-service/.env') | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $dbLine) { throw 'content-service/.env 缺少 DATABASE_URL。' }
$env:DATABASE_URL = (($dbLine -replace '^DATABASE_URL=', '').Trim('"')) -replace '/mowo_db([?\"]|$)', '/mowo_b1_test$1'
if ($env:DATABASE_URL -notmatch '/mowo_b1_test(?:\?|$)') { throw '无法安全生成 mowo_b1_test 连接地址。' }

$node = (Get-Command node).Source
$api = Start-Process -FilePath $node -ArgumentList 'src/index.js' -WorkingDirectory (Join-Path $RepoRoot 'content-service') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $RunDir 'api.out.log') -RedirectStandardError (Join-Path $RunDir 'api.err.log')
Save-OwnedProcess $api $ApiPidFile 'src/index.js'

$webArgs = @((Join-Path $RepoRoot 'scripts/static-server.mjs'), '--root=frontend', '--mount=mowo/frontend', '--port=5500')
$web = Start-Process -FilePath $node -ArgumentList $webArgs -WorkingDirectory $RepoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $RunDir 'web.out.log') -RedirectStandardError (Join-Path $RunDir 'web.err.log')
Save-OwnedProcess $web $WebPidFile 'static-server.mjs'

try {
  Wait-Url 'http://127.0.0.1:3001/'
  Wait-Url 'http://127.0.0.1:5500/mowo/frontend/pages/index.html'
} catch {
  & $PSCommandPath stop
  throw
}

Write-Host '本地服务已启动（数据库：mowo_b1_test）：'
Write-Host '  首页：http://127.0.0.1:5500/mowo/frontend/pages/index.html'
Write-Host '  API：http://127.0.0.1:3001/'
Write-Host '停止命令：pwsh -File scripts/local.ps1 stop'
