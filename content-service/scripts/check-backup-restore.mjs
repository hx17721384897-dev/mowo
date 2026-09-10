import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import dotenv from 'dotenv'

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(serviceRoot, '..')
dotenv.config({ path: resolve(serviceRoot, '.env'), quiet: true })

const sourceUrl = new URL(process.env.DATABASE_URL || '')
const testUrl = new URL(sourceUrl)
testUrl.pathname = '/mowo_b1_test'
const databaseName = testUrl.pathname.slice(1)
if (databaseName !== 'mowo_b1_test') throw new Error('Refusing backup/restore outside mowo_b1_test')

const adminUrl = new URL(testUrl)
adminUrl.pathname = '/postgres'
const backupDir = resolve(repoRoot, '.local-backups')
const backupPath = resolve(backupDir, 'mowo_b1_test-latest.dump')
mkdirSync(backupDir, { recursive: true })

const pgEnv = {
  ...process.env,
  PGHOST: testUrl.hostname,
  PGPORT: testUrl.port || '5432',
  PGUSER: decodeURIComponent(testUrl.username),
  PGPASSWORD: decodeURIComponent(testUrl.password),
  PGDATABASE: databaseName
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: serviceRoot, env: pgEnv, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}`)
}

async function fingerprint() {
  const client = new Client({ connectionString: testUrl.toString() })
  await client.connect()
  try {
    const result = await client.query(`
      SELECT
        (SELECT count(*)::int FROM "users") AS users,
        (SELECT count(*)::int FROM "machine_models") AS machine_models,
        (SELECT count(*)::int FROM "machine_model_skus") AS skus,
        (SELECT count(*)::int FROM "sku_inventory") AS inventory,
        (SELECT count(*)::int FROM "_prisma_migrations" WHERE finished_at IS NOT NULL) AS migrations
    `)
    return result.rows[0]
  } finally {
    await client.end()
  }
}

const before = await fingerprint()
run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--file=${backupPath}`])
if (!existsSync(backupPath)) throw new Error('Backup file was not created')

const admin = new Client({ connectionString: adminUrl.toString() })
await admin.connect()
try {
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [databaseName])
  await admin.query(`DROP DATABASE "${databaseName}"`)
  await admin.query(`CREATE DATABASE "${databaseName}"`)
} finally {
  await admin.end()
}

run('pg_restore', ['--exit-on-error', '--no-owner', '--no-privileges', `--dbname=${databaseName}`, backupPath])
const after = await fingerprint()
if (JSON.stringify(before) !== JSON.stringify(after)) {
  throw new Error(`Restore fingerprint mismatch: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
}

const prismaCli = resolve(serviceRoot, 'node_modules/prisma/build/index.js')
const migrationStatus = spawnSync(process.execPath, [prismaCli, 'migrate', 'status'], {
  cwd: serviceRoot,
  env: { ...process.env, DATABASE_URL: testUrl.toString() },
  encoding: 'utf8'
})
if (migrationStatus.error) throw migrationStatus.error
if (migrationStatus.status !== 0 || !migrationStatus.stdout.includes('Database schema is up to date')) {
  process.stdout.write(migrationStatus.stdout || '')
  process.stderr.write(migrationStatus.stderr || '')
  throw new Error('Restored database did not pass prisma migrate status')
}

console.log(`Backup/restore drill passed for mowo_b1_test: ${JSON.stringify(after)}`)
console.log(`Local backup retained at ${backupPath}`)
