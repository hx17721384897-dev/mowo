import crypto from 'crypto'

function hashIdentifier(secret, value) {
  return crypto.createHmac('sha256', secret).update(String(value || 'unknown')).digest('hex')
}

function fixedWindow(now, windowMs) {
  const startMs = Math.floor(now.getTime() / windowMs) * windowMs
  return {
    key: String(startMs),
    expiresAt: new Date(startMs + windowMs)
  }
}

export async function getRateLimitCount(fastify, input) {
  const now = input.now instanceof Date ? input.now : new Date()
  const window = fixedWindow(now, input.windowMs)
  const subjectHash = hashIdentifier(fastify.config.storage.signingSecret, input.subject)
  const targetHash = input.target
    ? hashIdentifier(fastify.config.storage.signingSecret, input.target)
    : ''
  const bucket = await fastify.prisma.rateLimitBucket.findUnique({
    where: {
      scope_subjectHash_targetHash_windowKey: {
        scope: input.scope, subjectHash, targetHash, windowKey: window.key
      }
    },
    select: { count: true }
  })
  return bucket?.count || 0
}

export async function consumeRateLimit(fastify, request, input) {
  const now = input.now instanceof Date ? input.now : new Date()
  const window = fixedWindow(now, input.windowMs)
  const subjectHash = hashIdentifier(fastify.config.storage.signingSecret, input.subject)
  const targetHash = input.target
    ? hashIdentifier(fastify.config.storage.signingSecret, input.target)
    : ''
  const cost = Math.max(1, Number(input.cost) || 1)
  const bucket = await fastify.prisma.rateLimitBucket.upsert({
    where: {
      scope_subjectHash_targetHash_windowKey: {
        scope: input.scope, subjectHash, targetHash, windowKey: window.key
      }
    },
    create: {
      scope: input.scope, subjectHash, targetHash, windowKey: window.key,
      count: cost, expiresAt: window.expiresAt
    },
    update: { count: { increment: cost }, expiresAt: window.expiresAt },
    select: { count: true }
  })

  if (bucket.count <= input.limit) return { allowed: true, remaining: input.limit - bucket.count }

  await fastify.prisma.auditLog.create({
    data: {
      userId: request.user?.userId || null,
      action: 'RATE_LIMIT_BLOCKED',
      detail: { scope: input.scope, limit: input.limit, windowSeconds: Math.ceil(input.windowMs / 1000) },
      ip: request.ip || null
    }
  }).catch(() => {})

  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil((window.expiresAt.getTime() - now.getTime()) / 1000))
  }
}

export async function enforceRateLimit(fastify, request, reply, input) {
  const result = await consumeRateLimit(fastify, request, input)
  if (result.allowed) return true
  reply.header('Retry-After', String(result.retryAfterSeconds))
  reply.code(429).send({
    success: false,
    message: input.message || '操作过于频繁，请稍后再试',
    code: 'RATE_LIMITED',
    retryAfterSeconds: result.retryAfterSeconds
  })
  return false
}

export async function enforceSmsSendLimits(fastify, request, reply, phone) {
  const limits = fastify.config.rateLimits
  if (!await enforceRateLimit(fastify, request, reply, {
    scope: 'SMS_PHONE_DAILY', subject: phone, windowMs: 24 * 60 * 60 * 1000,
    limit: limits.smsPhoneDaily, message: '该手机号今天获取验证码次数已达上限，请明天再试'
  })) return false

  if (!await enforceRateLimit(fastify, request, reply, {
    scope: 'SMS_IP_HOURLY', subject: request.ip, windowMs: 60 * 60 * 1000,
    limit: limits.smsIpHourly, message: '当前网络获取验证码过于频繁，请稍后再试'
  })) return false

  const now = new Date()
  const window = fixedWindow(now, 60 * 60 * 1000)
  const subjectHash = hashIdentifier(fastify.config.storage.signingSecret, request.ip)
  const targetHash = hashIdentifier(fastify.config.storage.signingSecret, phone)
  await fastify.prisma.rateLimitBucket.upsert({
    where: {
      scope_subjectHash_targetHash_windowKey: {
        scope: 'SMS_IP_DISTINCT_PHONE', subjectHash, targetHash, windowKey: window.key
      }
    },
    create: {
      scope: 'SMS_IP_DISTINCT_PHONE', subjectHash, targetHash, windowKey: window.key,
      count: 1, expiresAt: window.expiresAt
    },
    update: { expiresAt: window.expiresAt }
  })
  const distinctCount = await fastify.prisma.rateLimitBucket.count({
    where: { scope: 'SMS_IP_DISTINCT_PHONE', subjectHash, windowKey: window.key }
  })
  if (distinctCount <= limits.smsIpDistinctPhonesHourly) return true

  await fastify.prisma.auditLog.create({
    data: {
      userId: request.user?.userId || null,
      action: 'RATE_LIMIT_BLOCKED',
      detail: { scope: 'SMS_IP_DISTINCT_PHONES', limit: limits.smsIpDistinctPhonesHourly },
      ip: request.ip || null
    }
  }).catch(() => {})
  const retryAfterSeconds = Math.max(1, Math.ceil((window.expiresAt.getTime() - now.getTime()) / 1000))
  reply.header('Retry-After', String(retryAfterSeconds))
  reply.code(429).send({
    success: false,
    message: '当前网络尝试的手机号过多，请稍后再试',
    code: 'RATE_LIMITED',
    retryAfterSeconds
  })
  return false
}

export async function assertSmsVerificationAllowed(fastify, request) {
  const count = await getRateLimitCount(fastify, {
    scope: 'SMS_VERIFY_FAILURE', subject: request.ip, windowMs: 15 * 60 * 1000
  })
  if (count < fastify.config.rateLimits.verifyFailuresPer15Minutes) return

  const error = new Error('验证码错误次数过多，请15分钟后再试')
  error.code = 'VERIFY_TEMPORARILY_LOCKED'
  error.retryAfterSeconds = 15 * 60
  throw error
}

export async function recordSmsVerificationFailure(fastify, request) {
  await consumeRateLimit(fastify, request, {
    scope: 'SMS_VERIFY_FAILURE', subject: request.ip, windowMs: 15 * 60 * 1000,
    limit: fastify.config.rateLimits.verifyFailuresPer15Minutes
  })
}

export function rateLimitHashForTest(secret, value) {
  return hashIdentifier(secret, value)
}
