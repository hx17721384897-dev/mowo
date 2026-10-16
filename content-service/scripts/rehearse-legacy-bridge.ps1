param(
  [string]$BackupPath = ''
)

$ErrorActionPreference = 'Stop'
$serviceRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $serviceRoot
if (-not $BackupPath) {
  $BackupPath = Join-Path $repoRoot '.local-backups/mowo_db-reconcile-20261015-175955.dump'
}
$BackupPath = (Resolve-Path -LiteralPath $BackupPath).Path
$expectedHash = 'C85FFA2C0135EDD957AB77B34930014283B3F34623CFB540502A65959AFAE093'
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $BackupPath).Hash -ne $expectedHash) {
  throw 'The source backup hash differs from the audited mowo_db backup.'
}

$dbLine = Get-Content -LiteralPath (Join-Path $serviceRoot '.env') |
  Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $dbLine) { throw 'DATABASE_URL is missing.' }
$dbUri = [Uri](($dbLine -replace '^DATABASE_URL=', '').Trim('"'))
if ($dbUri.Scheme -notin @('postgres', 'postgresql') -or
    $dbUri.Host -notin @('localhost', '127.0.0.1', '::1') -or
    $dbUri.AbsolutePath.TrimStart('/') -ne 'mowo_db') {
  throw 'Only the audited local mowo_db connection may be used to locate PostgreSQL.'
}
$credentials = $dbUri.UserInfo.Split(':', 2)
if ($credentials.Count -ne 2) { throw 'DATABASE_URL must contain PostgreSQL credentials.' }
$env:PGHOST = $dbUri.Host
$env:PGPORT = [string]$dbUri.Port
$env:PGUSER = [Uri]::UnescapeDataString($credentials[0])
$env:PGPASSWORD = [Uri]::UnescapeDataString($credentials[1])
$cloneName = 'mowo_rehearsal_' + (Get-Date -Format 'yyyyMMdd') + '_' + ([Guid]::NewGuid().ToString('N').Substring(0, 8))
$cloneCreated = $false

function Invoke-Pg([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}

# Only replay repository migrations that add missing structures. Never replay retired-column
# deletion or use the automatically generated destructive schema diff.
$additiveMigrations = @(
  '20260918170000_add_custom_product_idempotency',
  '20260920190000_add_cart_mutation_idempotency',
  '20260928143000_add_frame_draft_idempotency',
  '20260928190000_add_frame_import_idempotency',
  '20260928210000_add_collab_frame_pack_mutations',
  '20260929160000_add_production_reprint_idempotency',
  '20260929180000_add_production_batch_idempotency',
  '20260930100000_add_print_config_idempotency',
  '20261008120000_add_inventory_adjustment_fingerprint',
  '20261009100000_add_inventory_material_mutations',
  '20261009170000_harden_inventory_returns',
  '20261015120000_add_fulfillment_hold'
)

try {
  Invoke-Pg 'createdb' @('--template=template0', $cloneName)
  $cloneCreated = $true
  Invoke-Pg 'pg_restore' @('--exit-on-error', '--no-owner', '--no-privileges', '--dbname', $cloneName, $BackupPath)
  foreach ($migration in $additiveMigrations) {
    $sqlPath = Join-Path $serviceRoot "prisma/migrations/$migration/migration.sql"
    if (-not (Test-Path -LiteralPath $sqlPath)) { throw "Missing migration: $migration" }
    Write-Output "Applying to temporary restore: $migration"
    Invoke-Pg 'psql' @('-X', '-v', 'ON_ERROR_STOP=1', '-q', '-d', $cloneName, '-f', $sqlPath)
  }
  $verification = @'
DO $$
BEGIN
  IF (SELECT count(*) FROM users) <> 15 OR
     (SELECT count(*) FROM private_files) <> 456 OR
     (SELECT count(*) FROM animation_assets) <> 28 OR
     (SELECT count(*) FROM pre_orders) <> 20 OR
     (SELECT count(*) FROM sales_orders) <> 6 OR
     (SELECT count(*) FROM sales_order_items) <> 10 OR
     (SELECT count(*) FROM customize_orders) <> 26 OR
     (SELECT count(*) FROM production_batches) <> 3 THEN
    RAISE EXCEPTION 'Audited historical row counts changed during rehearsal';
  END IF;
  IF EXISTS (SELECT 1 FROM sales_orders so LEFT JOIN pre_orders po ON po.id = so.pre_order_id WHERE po.id IS NULL) OR
     EXISTS (SELECT 1 FROM sales_order_items soi LEFT JOIN sales_orders so ON so.id = soi.sales_order_id WHERE so.id IS NULL) OR
     EXISTS (SELECT 1 FROM customize_orders pu LEFT JOIN sales_order_items soi ON soi.id = pu.sales_order_item_id WHERE pu.sales_order_item_id IS NOT NULL AND soi.id IS NULL) OR
     EXISTS (SELECT 1 FROM customize_orders pu LEFT JOIN production_batches pb ON pb.id = pu.batch_id WHERE pu.batch_id IS NOT NULL AND pb.id IS NULL) THEN
    RAISE EXCEPTION 'Historical order or production relationships are broken';
  END IF;
  IF (SELECT count(*) FROM production_batches WHERE client_request_id LIKE 'legacy-%' AND request_fingerprint = repeat('0', 64)) <> 3 OR
     EXISTS (SELECT 1 FROM sales_orders WHERE fulfillment_hold_minutes IS NOT NULL OR earliest_production_at IS NOT NULL) OR
     (SELECT count(*) FROM platform_configs WHERE config_key = 'fulfillment_hold_minutes' AND config_value = '60') <> 1 THEN
    RAISE EXCEPTION 'Production batch backfill or fulfillment hold rules differ from the approved design';
  END IF;
END $$;
SELECT 'Historical rows, order relationships, batch backfill and hold configuration verified';
'@
  Invoke-Pg 'psql' @('-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', $cloneName, '-c', $verification)
  Write-Output 'Additive bridge rehearsal succeeded; source mowo_db was not changed.'
} finally {
  if ($cloneCreated) {
    Invoke-Pg 'dropdb' @('--if-exists', '--force', $cloneName)
    Write-Output "Temporary restore removed: $cloneName"
  }
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
