const DEFAULT_DEV_ORIGINS = [
  'http://127.0.0.1:5500',
  'http://127.0.0.1:5501',
  'http://localhost:5500',
  'http://localhost:5501',
  'http://localhost:3000'
]

const PRODUCTION_PLACEHOLDERS = [
  'change_me',
  'replace_me',
  'replace_with',
  'mowo_dev_secret',
  'mowo_cookie_secret'
]

function readRequired(env, name, errors) {
  const value = env[name]?.trim()
  if (!value) errors.push(`${name} is required`)
  return value || ''
}

function parsePort(value, errors) {
  const port = Number(value || 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT must be an integer between 1 and 65535')
  }
  return port
}

function parseBoolean(value, fallback, name, errors) {
  if (value == null || value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  errors.push(`${name} must be true or false`)
  return fallback
}

function parsePositiveInteger(value, fallback, name, errors, maximum) {
  const parsed = value == null || value === '' ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    errors.push(`${name} must be an integer between 1 and ${maximum}`)
    return fallback
  }
  return parsed
}

function parseCorsOrigins(value, isProduction, errors) {
  const origins = value
    ? value.split(',').map(item => item.trim()).filter(Boolean)
    : isProduction ? [] : DEFAULT_DEV_ORIGINS

  if (isProduction && origins.length === 0) {
    errors.push('CORS_ORIGIN is required in production')
  }

  for (const origin of origins) {
    if (origin === '*') {
      errors.push('CORS_ORIGIN cannot contain *')
      continue
    }

    try {
      const parsed = new URL(origin)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol')
    } catch {
      errors.push(`CORS_ORIGIN contains an invalid origin: ${origin}`)
    }
  }

  return origins
}

function validateProductionSecret(name, value, errors) {
  if (value.length < 32) {
    errors.push(`${name} must contain at least 32 characters in production`)
  }

  const normalized = value.toLowerCase()
  if (PRODUCTION_PLACEHOLDERS.some(item => normalized.includes(item))) {
    errors.push(`${name} still contains a placeholder value`)
  }
}

export function loadConfig(env = process.env) {
  const errors = []
  const nodeEnv = env.NODE_ENV?.trim() || 'development'
  const allowedEnvironments = new Set(['development', 'test', 'production'])

  if (!allowedEnvironments.has(nodeEnv)) {
    errors.push('NODE_ENV must be development, test, or production')
  }

  const isProduction = nodeEnv === 'production'
  const databaseUrl = readRequired(env, 'DATABASE_URL', errors)
  const jwtSecret = readRequired(env, 'JWT_SECRET', errors)
  const cookieSecret = readRequired(env, 'COOKIE_SECRET', errors)
  const storageProvider = (env.STORAGE_PROVIDER?.trim() || (isProduction ? 'oss' : 'local')).toLowerCase()
  if (!['local', 'oss'].includes(storageProvider)) errors.push('STORAGE_PROVIDER must be local or oss')
  if (isProduction && storageProvider !== 'oss') errors.push('STORAGE_PROVIDER must be oss in production')
  const ossRegion = env.OSS_REGION?.trim() || ''
  const ossAccessKeyId = env.OSS_ACCESS_KEY_ID?.trim() || ''
  const ossAccessKeySecret = env.OSS_ACCESS_KEY_SECRET?.trim() || ''
  const ossBucket = env.OSS_BUCKET?.trim() || ''
  if (storageProvider === 'oss') {
    if (!ossRegion) errors.push('OSS_REGION is required when STORAGE_PROVIDER is oss')
    if (!ossAccessKeyId) errors.push('OSS_ACCESS_KEY_ID is required when STORAGE_PROVIDER is oss')
    if (!ossAccessKeySecret) errors.push('OSS_ACCESS_KEY_SECRET is required when STORAGE_PROVIDER is oss')
    if (!ossBucket) errors.push('OSS_BUCKET is required when STORAGE_PROVIDER is oss')
  }
  const smsMock = parseBoolean(env.SMS_MOCK, !isProduction, 'SMS_MOCK', errors)
  const passwordLoginEnabled = parseBoolean(
    env.PASSWORD_LOGIN_ENABLED,
    false,
    'PASSWORD_LOGIN_ENABLED',
    errors
  )
  const port = parsePort(env.PORT, errors)
  const corsOrigins = parseCorsOrigins(env.CORS_ORIGIN, isProduction, errors)
  const privacyVersion = env.CURRENT_PRIVACY_VERSION?.trim() || (isProduction ? '' : 'dev-2026-08')
  const userAgreementVersion = env.CURRENT_USER_AGREEMENT_VERSION?.trim() || (isProduction ? '' : 'test-2026-08')
  const communityEnabled = parseBoolean(env.COMMUNITY_ENABLED, false, 'COMMUNITY_ENABLED', errors)
  const creatorFinanceEnabled = parseBoolean(env.CREATOR_FINANCE_ENABLED, false, 'CREATOR_FINANCE_ENABLED', errors)
  const bullSystemEnabled = parseBoolean(env.BULL_SYSTEM_ENABLED, false, 'BULL_SYSTEM_ENABLED', errors)
  const mockCertificationEnabled = parseBoolean(env.MOCK_CERTIFICATION_ENABLED, false, 'MOCK_CERTIFICATION_ENABLED', errors)
  const creatorCollabSelfServiceEnabled = parseBoolean(
    env.CREATOR_COLLAB_SELF_SERVICE_ENABLED,
    false,
    'CREATOR_COLLAB_SELF_SERVICE_ENABLED',
    errors
  )
  const avatarRetentionHours = parsePositiveInteger(
    env.AVATAR_ORPHAN_RETENTION_HOURS,
    24,
    'AVATAR_ORPHAN_RETENTION_HOURS',
    errors,
    720
  )
  const privateFileCleanupIntervalMinutes = parsePositiveInteger(
    env.PRIVATE_FILE_CLEANUP_INTERVAL_MINUTES,
    60,
    'PRIVATE_FILE_CLEANUP_INTERVAL_MINUTES',
    errors,
    1440
  )
  const accountDeletionGraceMinutes = parsePositiveInteger(
    env.ACCOUNT_DELETION_GRACE_MINUTES,
    10,
    'ACCOUNT_DELETION_GRACE_MINUTES',
    errors,
    1440
  )
  const accountDeletionRetryMinutes = parsePositiveInteger(
    env.ACCOUNT_DELETION_RETRY_MINUTES,
    15,
    'ACCOUNT_DELETION_RETRY_MINUTES',
    errors,
    1440
  )
  const accountDeletionManualAfterAttempts = parsePositiveInteger(
    env.ACCOUNT_DELETION_MANUAL_AFTER_ATTEMPTS,
    3,
    'ACCOUNT_DELETION_MANUAL_AFTER_ATTEMPTS',
    errors,
    20
  )
  const accountDeletionManualAfterMinutes = parsePositiveInteger(
    env.ACCOUNT_DELETION_MANUAL_AFTER_MINUTES,
    60,
    'ACCOUNT_DELETION_MANUAL_AFTER_MINUTES',
    errors,
    10080
  )
  const accountDeletionJobIntervalMinutes = parsePositiveInteger(
    env.ACCOUNT_DELETION_JOB_INTERVAL_MINUTES,
    1,
    'ACCOUNT_DELETION_JOB_INTERVAL_MINUTES',
    errors,
    1440
  )

  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push('DATABASE_URL must be a PostgreSQL connection URL')
  }

  if (isProduction) {
    validateProductionSecret('JWT_SECRET', jwtSecret, errors)
    validateProductionSecret('COOKIE_SECRET', cookieSecret, errors)
    if (jwtSecret && jwtSecret === cookieSecret) {
      errors.push('JWT_SECRET and COOKIE_SECRET must be different in production')
    }
    if (smsMock) errors.push('SMS_MOCK must be false in production')
    if (!privacyVersion) errors.push('CURRENT_PRIVACY_VERSION is required in production')
    if (!userAgreementVersion) errors.push('CURRENT_USER_AGREEMENT_VERSION is required in production')

    for (const [name, value] of [
      ['DATABASE_URL', databaseUrl],
      ['OSS_REGION', ossRegion],
      ['OSS_ACCESS_KEY_ID', ossAccessKeyId],
      ['OSS_ACCESS_KEY_SECRET', ossAccessKeySecret],
      ['OSS_BUCKET', ossBucket]
    ]) {
      const normalized = value.toLowerCase()
      if (PRODUCTION_PLACEHOLDERS.some(item => normalized.includes(item))) {
        errors.push(`${name} still contains a placeholder value`)
      }
    }
  }

  const sms = {
    mock: smsMock,
    accessKey: env.ALI_SMS_ACCESS_KEY?.trim() || '',
    secret: env.ALI_SMS_SECRET?.trim() || '',
    signName: env.ALI_SMS_SIGN_NAME?.trim() || '',
    loginTemplate: env.ALI_SMS_TEMPLATE_LOGIN?.trim() || ''
  }

  if (!sms.mock) {
    for (const [name, value] of [
      ['ALI_SMS_ACCESS_KEY', sms.accessKey],
      ['ALI_SMS_SECRET', sms.secret],
      ['ALI_SMS_SIGN_NAME', sms.signName],
      ['ALI_SMS_TEMPLATE_LOGIN', sms.loginTemplate]
    ]) {
      if (!value) errors.push(`${name} is required when SMS_MOCK is false`)
    }
  }

  if (errors.length > 0) {
    throw new Error(`Environment configuration is invalid:\n- ${errors.join('\n- ')}`)
  }

  return Object.freeze({
    nodeEnv,
    isProduction,
    host: env.HOST?.trim() || '0.0.0.0',
    port,
    databaseUrl,
    jwtSecret,
    cookieSecret,
    corsOrigins,
    privacyVersion,
    userAgreementVersion,
    passwordLoginEnabled,
    features: Object.freeze({
      community: communityEnabled,
      creatorFinance: creatorFinanceEnabled,
      bullSystem: bullSystemEnabled,
      mockCertification: mockCertificationEnabled,
      creatorCollabSelfService: creatorCollabSelfServiceEnabled,
      passwordLogin: passwordLoginEnabled
    }),
    rateLimits: Object.freeze({
      smsPhoneDaily: 10,
      smsIpHourly: 30,
      smsIpDistinctPhonesHourly: 10,
      verifyFailuresPer15Minutes: 10,
      contactIpHourly: 5,
      uploadAccountPer10Minutes: 60,
      uploadAnonymousPerHour: 20
    }),
    storage: Object.freeze({
      provider: storageProvider,
      localDir: env.LOCAL_STORAGE_DIR?.trim() || 'storage/private',
      signingSecret: env.FILE_SIGNING_SECRET?.trim() || cookieSecret
    }),
    privateFileCleanup: Object.freeze({
      avatarRetentionHours,
      intervalMinutes: privateFileCleanupIntervalMinutes,
      batchSize: 100
    }),
    accountDeletion: Object.freeze({
      graceMinutes: accountDeletionGraceMinutes,
      retryMinutes: accountDeletionRetryMinutes,
      manualAfterAttempts: accountDeletionManualAfterAttempts,
      manualAfterMinutes: accountDeletionManualAfterMinutes,
      urgentAfterHours: 24,
      resolutionTargetHours: 48,
      intervalMinutes: accountDeletionJobIntervalMinutes,
      batchSize: 20
    }),
    oss: Object.freeze({
      region: ossRegion,
      accessKeyId: ossAccessKeyId,
      accessKeySecret: ossAccessKeySecret,
      bucket: ossBucket
    }),
    sms: Object.freeze(sms)
  })
}
