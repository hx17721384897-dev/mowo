import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import dotenv from 'dotenv'

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: resolve(serviceRoot, '.env'), quiet: true })

const action = process.argv[2] || 'status'
const sourceUrl = new URL(process.env.DATABASE_URL || '')
const testUrl = new URL(sourceUrl)
testUrl.pathname = '/mowo_b1_test'
const databaseName = testUrl.pathname.slice(1)
if (databaseName !== 'mowo_b1_test') throw new Error('Refusing to manage a database other than mowo_b1_test')

const adminUrl = new URL(testUrl)
adminUrl.pathname = '/postgres'

function run(command, args, extraEnv = {}) {
  const executable = command === 'prisma' ? process.execPath : command
  const commandArgs = command === 'prisma'
    ? [resolve(serviceRoot, 'node_modules/prisma/build/index.js'), ...args]
    : args
  const result = spawnSync(executable, commandArgs, {
    cwd: serviceRoot,
    env: { ...process.env, DATABASE_URL: testUrl.toString(), ...extraEnv },
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}`)
}

async function recreate() {
  const admin = new Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [databaseName])
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
    await admin.query(`CREATE DATABASE "${databaseName}"`)
  } finally {
    await admin.end()
  }
}

async function status() {
  const client = new Client({ connectionString: testUrl.toString() })
  await client.connect()
  try {
    const result = await client.query(`
      SELECT
        (SELECT count(*)::int FROM "users") AS users,
        (SELECT count(*)::int FROM "machine_models") AS machine_models,
        (SELECT count(*)::int FROM "machine_model_skus") AS skus,
        (SELECT count(*)::int FROM "_prisma_migrations" WHERE finished_at IS NOT NULL) AS migrations
    `)
    console.log(`mowo_b1_test ready: ${JSON.stringify(result.rows[0])}`)
  } finally {
    await client.end()
  }
}

if (action === 'rebuild') {
  console.log('Rebuilding isolated database mowo_b1_test ...')
  await recreate()
  run('prisma', ['migrate', 'deploy'])
  run('prisma', ['db', 'seed'], {
    ALLOW_DEMO_SEED: 'true',
    DEMO_SEED_PASSWORD: `Local-${randomBytes(18).toString('base64url')}`
  })
  await status()
} else if (action === 'status') {
  await status()
} else {
  throw new Error(`Unknown action: ${action}. Use rebuild or status.`)
}
