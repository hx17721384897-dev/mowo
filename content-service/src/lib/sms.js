// src/lib/sms.js
// 短信服务：阿里云SMS + Mock模式 + 全局计数器
// SMS_MOCK=true 时不发真实短信，code固定为123456（开发用）

import crypto from 'crypto'
import https from 'https'
import querystring from 'querystring'

const SMS_MOCK = process.env.SMS_MOCK === 'true'

// 短信每手机号冷却时间（毫秒）
const SMS_COOLDOWN_MS = 60 * 1000 // 1分钟（生产建议2-3分钟）
// 单条验证码有效期（毫秒）
const SMS_CODE_EXPIRE_MS = 5 * 60 * 1000 // 5分钟
// 全局每小时上限
const SMS_HOURLY_LIMIT = 500

export async function assertSmsCooldownAllowed(prisma, phone, purpose) {
  const cooldownAgo = new Date(Date.now() - SMS_COOLDOWN_MS)
  const recentCode = await prisma.smsCode.findFirst({
    where: { phone, purpose, createdAt: { gte: cooldownAgo } },
    orderBy: { createdAt: 'desc' },
    select: { id: true }
  })
  if (recentCode) {
    throw Object.assign(new Error('发送太频繁，请稍后重试'), { code: 'SMS_TOO_FREQUENT' })
  }
}

/** 生成6位数字验证码 */
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/**
 * 调用阿里云SMS API（RPC风格签名）
 * 文档：https://help.aliyun.com/document_detail/101414.html
 */
async function callAliyunSms(phone, code, purpose) {
  const accessKey = process.env.ALI_SMS_ACCESS_KEY
  const accessSecret = process.env.ALI_SMS_SECRET
  const signName = process.env.ALI_SMS_SIGN_NAME
  const templateCode = process.env.ALI_SMS_TEMPLATE_LOGIN || process.env[`ALI_SMS_TEMPLATE_${purpose}`]

  if (!accessKey || !accessSecret || !signName || !templateCode) {
    throw new Error('阿里云SMS配置不完整，请检查环境变量')
  }

  const params = {
    AccessKeyId: accessKey,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    SignName: signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomBytes(16).toString('hex'),
    SignatureVersion: '1.0',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25'
  }

  // 按字母排序，URL编码
  const sorted = Object.keys(params).sort().reduce((acc, k) => {
    acc[k] = params[k]
    return acc
  }, {})

  const canonicalParams = Object.entries(sorted)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const stringToSign = `POST&${encodeURIComponent('/')}&${encodeURIComponent(canonicalParams)}`
  const signature = crypto
    .createHmac('sha1', accessSecret + '&')
    .update(stringToSign)
    .digest('base64')

  const body = querystring.stringify({ ...sorted, Signature: signature })

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'dysmsapi.aliyuncs.com',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = ''
      res.on('data', d => data += d)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.Code !== 'OK') {
            reject(new Error(`阿里云SMS错误：${json.Code} - ${json.Message}`))
          } else {
            resolve(json)
          }
        } catch (e) {
          reject(new Error('SMS响应解析失败'))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/**
 * 发送短信验证码
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} phone
 * @param {string} purpose - SmsPurpose 枚举值
 * @returns {{ mock: boolean, code?: string }} mock模式时返回code
 */
export async function sendSmsCode(prisma, phone, purpose) {
  // 冷却检查必须早于所有额度计数，避免未实际发送的重复点击消耗额度。
  await assertSmsCooldownAllowed(prisma, phone, purpose)

  // 1. 全局每小时计数器检查（防短信轰炸）
  const hourKey = new Date().toISOString().slice(0, 13) // "2025-01-01T12"
  const counter = await prisma.smsGlobalCounter.upsert({
    where: { hourKey },
    create: { hourKey, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true }
  })
  if (counter.count > SMS_HOURLY_LIMIT) {
    throw Object.assign(new Error('短信发送已达今日上限，请稍后再试'), { code: 'SMS_QUOTA_EXCEEDED' })
  }

  // 2. 作废该手机号该用途的旧验证码
  await prisma.smsCode.updateMany({
    where: { phone, purpose, usedAt: null },
    data: { usedAt: new Date() }
  })

  // 3. 生成验证码（mock模式固定123456）
  const code = SMS_MOCK ? '123456' : generateCode()
  const expiresAt = new Date(Date.now() + SMS_CODE_EXPIRE_MS)

  // 4. 入库
  await prisma.smsCode.create({
    data: { phone, code, purpose, expiresAt }
  })

  // 5. 发送
  if (SMS_MOCK) {
    console.log(`[SMS MOCK] Phone: ${phone}, Code: ${code}, Purpose: ${purpose}`)
    return { mock: true, code } // 开发模式：返回code（仅供测试，生产不暴露）
  } else {
    await callAliyunSms(phone, code, purpose)
    return { mock: false }
  }
}

/**
 * 验证短信验证码
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} phone
 * @param {string} code
 * @param {string} purpose
 * @throws 验证失败时抛出带code属性的Error
 */
export async function verifySmsCode(prisma, phone, code, purpose) {
  const record = await prisma.smsCode.findFirst({
    where: {
      phone,
      purpose,
      usedAt: null,
      expiresAt: { gte: new Date() }
    },
    orderBy: { createdAt: 'desc' }
  })

  if (!record) {
    throw Object.assign(new Error('验证码不存在或已过期'), { code: 'CODE_NOT_FOUND' })
  }

  if (record.attempts >= 5) {
    throw Object.assign(new Error('验证码尝试次数过多，请重新获取'), { code: 'CODE_TOO_MANY_ATTEMPTS' })
  }

  // 先记录尝试次数（无论对错）
  await prisma.smsCode.update({
    where: { id: record.id },
    data: { attempts: { increment: 1 } }
  })

  if (record.code !== code) {
    throw Object.assign(new Error('验证码不正确'), { code: 'CODE_INVALID' })
  }

  // 标记已使用
  await prisma.smsCode.update({
    where: { id: record.id },
    data: { usedAt: new Date() }
  })

  return true
}
