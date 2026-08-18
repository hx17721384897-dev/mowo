// src/routes/contact.js
// 联络表单提交接口（公开，无需登录）
// 防护：IP频率限制 + 内容过滤 + 恶意IP自动封禁

import { FILE_PURPOSE, anonymousOwnerHash, findOwnedReadyFiles, linkFiles } from '../lib/private-files.js'
import { enforceRateLimit } from '../lib/rate-limit.js'

// key: ip, value: spamCount（24h内被标记垃圾次数）
const ipSpamMap = new Map()

// 已封禁IP集合（重启后从DB重载）
const blockedIPs = new Set()

// 垃圾触发自动封禁阈值
const SPAM_BAN_THRESHOLD = 3

// 关键词黑名单（只检测 name/contact/message，不检测链接字段）
const SPAM_KEYWORDS = [
  'casino', 'viagra', 'porn', 'xxx', 'free money', 'click here',
  '赌博', '博彩', '色情', '兼职刷单', '贷款', '代开发票', '免费领取',
]

// 字段最大长度限制
const MAX_LENGTHS = {
  name:    100,
  contact: 200,
  message: 2000,
  extra:   1000,
}

function containsSpam(text) {
  if (!text) return false
  const lower = text.toLowerCase()
  return SPAM_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))
}

function checkLength(val, max) {
  return !val || val.length <= max
}

export default async function contactRoutes(fastify) {

  // ── 启动时从DB加载已封禁IP ──
  try {
    const banned = await fastify.prisma.contactSubmission.findMany({
      where:   { isBlocked: true },
      select:  { ip: true },
      distinct: ['ip']
    })
    banned.forEach(r => r.ip && blockedIPs.add(r.ip))
    fastify.log.info(`联络表单：已加载 ${blockedIPs.size} 个封禁IP`)
  } catch(e) {
    fastify.log.warn('加载封禁IP失败：' + e.message)
  }

  // ══════════════════════════════════════════
  // POST /api/contact — 提交联络表单
  // ══════════════════════════════════════════
  fastify.post('/', { preHandler: [fastify.optionalAuthenticate] }, async (request, reply) => {
    const ip = request.ip || 'unknown'
    const today = new Date().toISOString().slice(0, 10)

    // ── 1. 封禁IP检查 ──
    if (blockedIPs.has(ip)) {
      return reply.code(403).send({ success: false, message: '提交失败，请联系客服' })
    }

    // ── 2. 频率限制：数据库计数，重启或多实例不能绕过 ──
    if (!await enforceRateLimit(fastify, request, reply, {
      scope: 'CONTACT_IP_HOURLY', subject: ip, windowMs: 60 * 60 * 1000,
      limit: fastify.config.rateLimits.contactIpHourly,
      message: '当前网络提交过于频繁，请一小时后再试'
    })) return

    // ── 3. 参数解析与校验 ──
    const { type, name, contact, message, extra, attachments } = request.body

    const validTypes = ['artist', 'channel', 'media', 'join', 'feedback', 'factory']
    if (!type || !validTypes.includes(type)) {
      return reply.code(400).send({ success: false, message: '无效的提交类型' })
    }
    if (!name || !name.trim()) {
      return reply.code(400).send({ success: false, message: '姓名不能为空' })
    }
    if (!contact || !contact.trim()) {
      return reply.code(400).send({ success: false, message: '联系方式不能为空' })
    }
    if (!message || !message.trim()) {
      return reply.code(400).send({ success: false, message: '内容不能为空' })
    }

    // 长度校验
    if (!checkLength(name,    MAX_LENGTHS.name))    return reply.code(400).send({ success: false, message: '姓名过长' })
    if (!checkLength(contact, MAX_LENGTHS.contact)) return reply.code(400).send({ success: false, message: '联系方式过长' })
    if (!checkLength(message, MAX_LENGTHS.message)) return reply.code(400).send({ success: false, message: `内容不能超过 ${MAX_LENGTHS.message} 字` })

    const attachmentKeys = Array.isArray(attachments) ? attachments : []
    const allowedPurposes = type === 'artist'
      ? [FILE_PURPOSE.CONTACT_PORTFOLIO]
      : type === 'join' ? [FILE_PURPOSE.CONTACT_RESUME] : []
    if (attachmentKeys.length > (type === 'artist' ? 6 : type === 'join' ? 1 : 0)) {
      return reply.code(400).send({ success: false, message: '附件数量超过该表单允许范围' })
    }
    const ownerUserId = request.user?.userId || null
    const anonymousHash = ownerUserId ? null : anonymousOwnerHash(
      fastify.config.storage.signingSecret,
      request.headers['x-upload-session']
    )
    let ownedFiles = []
    try {
      ownedFiles = await findOwnedReadyFiles(fastify.prisma, attachmentKeys, ownerUserId, allowedPurposes, anonymousHash)
    } catch (error) {
      return reply.code(400).send({ success: false, message: error.message })
    }

    // ── 4. 垃圾内容检测（只检测核心文本字段，不检测链接字段）──
    let spamScore = 0
    const checkText = [name, contact, message].join(' ')
    if (containsSpam(checkText)) spamScore = 2

    // 可疑：message 极短（少于5字）且无附件
    if (message.trim().length < 5 && !attachments?.length) spamScore = Math.max(spamScore, 1)

    // ── 5. 若命中垃圾，记录并检查是否需要封禁该IP ──
    if (spamScore >= 2) {
      const spamEntry = ipSpamMap.get(ip) || { count: 0, date: today }
      if (spamEntry.date !== today) { spamEntry.count = 0; spamEntry.date = today }
      spamEntry.count++
      ipSpamMap.set(ip, spamEntry)

      if (spamEntry.count >= SPAM_BAN_THRESHOLD) {
        blockedIPs.add(ip)
        // 写入DB标记（异步，不阻塞响应）
        fastify.prisma.contactSubmission.updateMany({
          where: { ip, status: 'spam' },
          data:  { isBlocked: true }
        }).catch(() => {})

        // 写审计日志提醒管理员
        fastify.prisma.operationLog.create({
          data: {
            userId:   'system',
            userRole: 0,
            method:   'POST',
            path:     '/api/contact',
            action:   `IP ${ip} 因多次提交垃圾内容已被自动封禁`,
            ip
          }
        }).catch(() => {})

        fastify.log.warn(`IP ${ip} 已自动封禁（垃圾提交 ${spamEntry.count} 次）`)
      }

      // 垃圾内容：仍然写入DB（方便管理员审查），但状态直接标spam
      await fastify.prisma.$transaction(async tx => {
        const submission = await tx.contactSubmission.create({ data: {
          type,
          name:            name.trim(),
          contact:         contact.trim(),
          message:         message.trim(),
          extra:           extra ? JSON.stringify(extra) : null,
          attachments:     attachments ? JSON.stringify(attachments) : null,
          submitterUserId: ownerUserId,
          ip,
          userAgent:   request.headers['user-agent'] || null,
          status:      'spam',
          spamScore,
          isBlocked:   blockedIPs.has(ip)
        } })
        await linkFiles(tx, ownedFiles, 'CONTACT_SUBMISSION', submission.id)
      })

      // 对用户假装成功（不暴露被识别）
      return reply.send({ success: true, message: '提交成功，我们会尽快与你联系' })
    }

    // ── 6. 正常写入 ──
    const submission = await fastify.prisma.$transaction(async tx => {
      const created = await tx.contactSubmission.create({ data: {
        type,
        name:            name.trim(),
        contact:         contact.trim(),
        message:         message.trim(),
        extra:           extra ? JSON.stringify(extra) : null,
        attachments:     attachments ? JSON.stringify(attachments) : null,
        submitterUserId: ownerUserId,
        ip,
        userAgent:   request.headers['user-agent'] || null,
        status:      'pending',
        spamScore
      } })
      await linkFiles(tx, ownedFiles, 'CONTACT_SUBMISSION', created.id)
      return created
    })

    return reply.send({
      success: true,
      message: '提交成功，我们会尽快与你联系',
      data:    { id: submission.id }
    })
  })

}
