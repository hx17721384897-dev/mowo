// src/routes/contact.js
// 联络表单提交接口（公开，无需登录）
// 防护：IP频率限制 + 内容过滤 + 恶意IP自动封禁

// ── 内存频率限制（重启清零，生产环境可换Redis） ──
// key: ip, value: { count, date }
const ipRateMap = new Map()

// key: ip, value: spamCount（24h内被标记垃圾次数）
const ipSpamMap = new Map()

// 已封禁IP集合（重启后从DB重载）
const blockedIPs = new Set()

// 各类型每天最大提交次数
const DAILY_LIMIT = 5

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

function getTodayKey() {
  return new Date().toISOString().slice(0, 10) // "2026-04-06"
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
  fastify.post('/', async (request, reply) => {
    const ip = request.ip || 'unknown'

    // ── 1. 封禁IP检查 ──
    if (blockedIPs.has(ip)) {
      return reply.code(403).send({ success: false, message: '提交失败，请联系客服' })
    }

    // ── 2. 频率限制：同一IP每天最多DAILY_LIMIT次 ──
    const today = getTodayKey()
    const rateEntry = ipRateMap.get(ip)
    if (rateEntry && rateEntry.date === today) {
      if (rateEntry.count >= DAILY_LIMIT) {
        return reply.code(429).send({
          success: false,
          message: `今天提交次数已达上限（${DAILY_LIMIT}次），请明天再试`
        })
      }
      rateEntry.count++
    } else {
      ipRateMap.set(ip, { count: 1, date: today })
    }

    // ── 3. 参数解析与校验 ──
    const { type, name, contact, message, extra, attachments, submitterUserId } = request.body

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
      await fastify.prisma.contactSubmission.create({
        data: {
          type,
          name:            name.trim(),
          contact:         contact.trim(),
          message:         message.trim(),
          extra:           extra ? JSON.stringify(extra) : null,
          attachments:     attachments ? JSON.stringify(attachments) : null,
          submitterUserId: submitterUserId || null,
          ip,
          userAgent:   request.headers['user-agent'] || null,
          status:      'spam',
          spamScore,
          isBlocked:   blockedIPs.has(ip)
        }
      })

      // 对用户假装成功（不暴露被识别）
      return reply.send({ success: true, message: '提交成功，我们会尽快与你联系' })
    }

    // ── 6. 正常写入 ──
    const submission = await fastify.prisma.contactSubmission.create({
      data: {
        type,
        name:            name.trim(),
        contact:         contact.trim(),
        message:         message.trim(),
        extra:           extra ? JSON.stringify(extra) : null,
        attachments:     attachments ? JSON.stringify(attachments) : null,
        submitterUserId: submitterUserId || null,
        ip,
        userAgent:   request.headers['user-agent'] || null,
        status:      'pending',
        spamScore
      }
    })

    return reply.send({
      success: true,
      message: '提交成功，我们会尽快与你联系',
      data:    { id: submission.id }
    })
  })

}
