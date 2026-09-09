/**
 * Prevent stateful local checks from silently using a developer or invitation
 * database.  The name is intentionally explicit until test configuration is
 * moved to a dedicated CI environment.
 */
export function requireIsolatedTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL || ''
  if (!databaseUrl.includes('mowo_b1_test')) {
    throw new Error(
      'Refusing to run a stateful check outside mowo_b1_test. Set DATABASE_URL to the isolated test database.'
    )
  }
}
