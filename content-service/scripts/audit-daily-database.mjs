import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import dotenv from 'dotenv'

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(serviceRoot, '..')
dotenv.config({ path: resolve(serviceRoot, '.env'), quiet: true })

const dailyUrl = new URL(process.env.DATABASE_URL || '')
const dailyDatabase = dailyUrl.pathname.slice(1)
const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
if (!['postgres:', 'postgresql:'].includes(dailyUrl.protocol)) {
  throw new Error('V6-B audit requires a PostgreSQL DATABASE_URL')
}
if (!localHosts.has(dailyUrl.hostname) || dailyDatabase !== 'mowo_db') {
  throw new Error('Refusing V6-B audit outside the local mowo_db database')
}

const referenceUrl = new URL(dailyUrl)
referenceUrl.pathname = '/mowo_b1_test'
const migrationsDir = resolve(serviceRoot, 'prisma', 'migrations')
const expectedMigrations = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const runDir = resolve(repoRoot, '.local-run')
const backupDir = resolve(repoRoot, '.local-backups')
mkdirSync(runDir, { recursive: true })
mkdirSync(backupDir, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const reportPath = resolve(runDir, `v6b-database-audit-${stamp}.json`)
const shouldBackup = process.argv.includes('--backup')

function pgEnvironment(url) {
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1)
  }
}

function runBackup() {
  const backupPath = resolve(backupDir, `mowo_db-v6b-${stamp}.dump`)
  const result = spawnSync(
    'pg_dump',
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--serializable-deferrable',
      `--file=${backupPath}`
    ],
    { cwd: serviceRoot, env: pgEnvironment(dailyUrl), stdio: 'inherit' }
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`pg_dump failed with exit ${result.status}`)
  const archive = spawnSync('pg_restore', ['--list', backupPath], {
    cwd: serviceRoot,
    env: pgEnvironment(dailyUrl),
    encoding: 'utf8'
  })
  if (archive.error) throw archive.error
  if (archive.status !== 0) throw new Error(`pg_restore --list failed with exit ${archive.status}`)
  const archiveEntries = archive.stdout
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith(';')).length
  if (!archiveEntries) throw new Error('Backup archive has no readable entries')
  return { path: backupPath, bytes: statSync(backupPath).size, archiveEntries }
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function queryRows(client, text, params = []) {
  return (await client.query(text, params)).rows
}

async function snapshot(url, label) {
  const client = new Client({ connectionString: url.toString() })
  await client.connect()
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const [{ current_database: database, transaction_read_only: readOnly }] = await queryRows(
      client,
      'SELECT current_database(), current_setting(\'transaction_read_only\') AS transaction_read_only'
    )
    if (readOnly !== 'on') throw new Error(`${label} connection is not read-only`)

    const tables = await queryRows(
      client,
      `SELECT c.relname AS table_name, c.relkind
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       ORDER BY c.relname`
    )
    const columns = await queryRows(
      client,
      `SELECT c.relname AS table_name,
              a.attname AS column_name,
              pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
              a.attnotnull AS not_null,
              pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_value
       FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
         AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY c.relname, a.attnum`
    )
    const constraints = await queryRows(
      client,
      `SELECT c.relname AS table_name, con.conname AS constraint_name, con.contype,
              pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
       FROM pg_catalog.pg_constraint con
       JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
       ORDER BY c.relname, con.conname`
    )
    const indexes = await queryRows(
      client,
      `SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
       FROM pg_catalog.pg_indexes
       WHERE schemaname = 'public'
       ORDER BY tablename, indexname`
    )
    const enums = await queryRows(
      client,
      `SELECT t.typname AS enum_name, e.enumsortorder, e.enumlabel
       FROM pg_catalog.pg_type t
       JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
       JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public'
       ORDER BY t.typname, e.enumsortorder`
    )

    const migrationTable = await queryRows(
      client,
      "SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present"
    )
    const migrations = migrationTable[0].present
      ? await queryRows(
          client,
          `SELECT migration_name, finished_at IS NOT NULL AS finished,
                  rolled_back_at IS NOT NULL AS rolled_back
           FROM "_prisma_migrations"
           ORDER BY migration_name`
        )
      : []

    const countAllowlist = [
      'users',
      'machine_models',
      'machine_model_skus',
      'private_files',
      'animation_assets',
      'animation_asset_versions',
      'frame_asset_import_batches',
      'frame_asset_import_items',
      'print_cut_groups',
      'print_template_versions',
      'sales_orders',
      'production_batches'
    ]
    const tableNames = new Set(tables.map((row) => row.table_name))
    const rowCounts = {}
    for (const table of countAllowlist) {
      if (!tableNames.has(table)) continue
      const [{ count }] = await queryRows(client, `SELECT count(*)::int AS count FROM "${table}"`)
      rowCounts[table] = count
    }

    // 仅在进程内比较身份键；报告只写计数，不写手机号、文件 Key 或业务 ID。
    const identityQueries = {
      userIds: 'SELECT id AS value FROM users',
      userPhones: 'SELECT phone AS value FROM users WHERE phone IS NOT NULL',
      customProductIds: 'SELECT id AS value FROM custom_products',
      animationAssetIds: 'SELECT id AS value FROM animation_assets',
      privateFileIds: 'SELECT id AS value FROM private_files',
      privateFileKeys: 'SELECT object_key AS value FROM private_files',
      preOrderIds: 'SELECT id AS value FROM pre_orders',
      salesOrderIds: 'SELECT id AS value FROM sales_orders'
    }
    const identityValues = {}
    for (const [name, sql] of Object.entries(identityQueries)) {
      identityValues[name] = (await queryRows(client, sql)).map((row) => row.value)
    }
    const readyLocalFiles = await queryRows(client,
      "SELECT object_key, purpose FROM private_files WHERE storage_provider = 'local' AND status = 'READY' AND deleted_at IS NULL")

    await client.query('COMMIT')
    return { database, tables, columns, constraints, indexes, enums, migrations, rowCounts, identityValues, readyLocalFiles }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

function compare(left, right, keyOf) {
  const leftMap = new Map(left.map((value) => [keyOf(value), value]))
  const rightMap = new Map(right.map((value) => [keyOf(value), value]))
  return {
    onlyDaily: [...leftMap.entries()].filter(([key]) => !rightMap.has(key)).map(([, value]) => value),
    onlyReference: [...rightMap.entries()]
      .filter(([key]) => !leftMap.has(key))
      .map(([, value]) => value),
    changed: [...leftMap.entries()]
      .filter(([key, value]) => rightMap.has(key) && JSON.stringify(value) !== JSON.stringify(rightMap.get(key)))
      .map(([key, value]) => ({ key, daily: value, reference: rightMap.get(key) }))
  }
}

let backup = null
if (shouldBackup) {
  backup = runBackup()
  backup.sha256 = await sha256(backup.path)
}

const [daily, reference] = await Promise.all([
  snapshot(dailyUrl, 'daily'),
  snapshot(referenceUrl, 'reference')
])
const finishedReference = new Set(reference.migrations
  .filter((item) => item.finished && !item.rolled_back)
  .map((item) => item.migration_name))
const missingReferenceMigrations = expectedMigrations.filter((name) => !finishedReference.has(name))
const extraReferenceMigrations = [...finishedReference].filter((name) => !expectedMigrations.includes(name))
const failedReferenceMigrations = reference.migrations.filter((item) => !item.finished && !item.rolled_back)
if (missingReferenceMigrations.length || failedReferenceMigrations.length) {
  throw new Error(
    `Reference mowo_b1_test is missing ${missingReferenceMigrations.length} repository migrations or has ${failedReferenceMigrations.length} failed migrations`
  )
}

const differenceKeys = {
  tables: (value) => value.table_name,
  columns: (value) => `${value.table_name}.${value.column_name}`,
  constraints: (value) => `${value.table_name}.${value.constraint_name}`,
  indexes: (value) => `${value.table_name}.${value.index_name}`,
  enums: (value) => `${value.enum_name}.${value.enumlabel}`
}
const differences = Object.fromEntries(
  Object.entries(differenceKeys).map(([section, keyOf]) => [
    section,
    compare(daily[section], reference[section], keyOf)
  ])
)
const identityOverlaps = Object.fromEntries(
  Object.keys(daily.identityValues).map((key) => {
    const source = new Set(daily.identityValues[key])
    return [key, reference.identityValues[key].filter((value) => source.has(value)).length]
  })
)
const localStorageRoot = resolve(serviceRoot, process.env.LOCAL_STORAGE_DIR?.trim() || 'storage/private')
const localFiles = { readyRegistered: daily.readyLocalFiles.length, found: 0, missing: 0, unsafeKey: 0, missingByPurpose: {} }
for (const file of daily.readyLocalFiles) {
  const key = String(file.object_key || '').replace(/\\/g, '/')
  const target = resolve(localStorageRoot, ...key.split('/'))
  const relativeTarget = relative(localStorageRoot, target)
  if (!key || key.startsWith('/') || key.split('/').includes('..') || !relativeTarget || relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
    localFiles.unsafeKey += 1
    continue
  }
  try {
    if (!statSync(target).isFile()) throw new Error('not a file')
    localFiles.found += 1
  } catch {
    localFiles.missing += 1
    localFiles.missingByPurpose[file.purpose] = (localFiles.missingByPurpose[file.purpose] || 0) + 1
  }
}
const finishedDaily = new Set(
  daily.migrations
    .filter((item) => item.finished && !item.rolled_back)
    .map((item) => item.migration_name)
)
const migrationLedger = {
  expected: expectedMigrations.length,
  dailyFinished: finishedDaily.size,
  referenceFinished: reference.migrations.filter((item) => item.finished && !item.rolled_back).length,
  missingFromDailyLedger: expectedMigrations.filter((name) => !finishedDaily.has(name)),
  unknownInDailyLedger: [...finishedDaily].filter((name) => !expectedMigrations.includes(name))
}

const report = {
  generatedAt: new Date().toISOString(),
  safety: {
    sourceDatabase: daily.database,
    referenceDatabase: reference.database,
    readOnlyTransactions: true,
    databaseMutations: 0,
    containsBusinessRows: false,
    referenceMatchesRepositoryExactly: extraReferenceMigrations.length === 0
  },
  backup,
  migrationLedger,
  referenceExtraMigrations: extraReferenceMigrations,
  objectCounts: {
    daily: Object.fromEntries(
      ['tables', 'columns', 'constraints', 'indexes', 'enums'].map((key) => [key, daily[key].length])
    ),
    reference: Object.fromEntries(
      ['tables', 'columns', 'constraints', 'indexes', 'enums'].map((key) => [key, reference[key].length])
    )
  },
  preservedDataCounts: daily.rowCounts,
  referenceDataCounts: reference.rowCounts,
  identityOverlaps,
  localFiles,
  differences
}
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log(`V6-B read-only database audit completed: ${daily.database} -> ${reference.database}`)
console.log(
  `Migration ledger: daily ${migrationLedger.dailyFinished}/${migrationLedger.expected}, reference ${migrationLedger.referenceFinished}/${migrationLedger.expected}`
)
if (extraReferenceMigrations.length) {
  console.log(`Reference warning: ${extraReferenceMigrations.length} extra completed migrations; schema differences are advisory until checked against a clean repository baseline`)
}
for (const [section, value] of Object.entries(differences)) {
  console.log(
    `${section}: daily-only ${value.onlyDaily.length}, reference-only ${value.onlyReference.length}, changed ${value.changed.length}`
  )
}
console.log(`Preserved data counts: ${JSON.stringify(daily.rowCounts)}`)
console.log(`Identity overlaps: ${JSON.stringify(identityOverlaps)}`)
console.log(`Old ready local files: ${localFiles.found}/${localFiles.readyRegistered} found, ${localFiles.missing} missing, ${localFiles.unsafeKey} unsafe keys`)
if (backup) console.log(`Backup: ${backup.path} (${backup.bytes} bytes, sha256 ${backup.sha256})`)
console.log(`Audit report: ${reportPath}`)
