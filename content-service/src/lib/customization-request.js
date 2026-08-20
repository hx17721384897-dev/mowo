import crypto from 'crypto'

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now).replaceAll('-', '')
}

function randomCode(length = 6) {
  const bytes = crypto.randomBytes(length)
  return [...bytes].map(value => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('')
}

export async function createCustomizationRequestNo(prisma) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const requestNo = `DZ-${shanghaiDate()}-${randomCode()}`
    const exists = await prisma.customizationRequest.findUnique({ where: { requestNo }, select: { id: true } })
    if (!exists) return requestNo
  }
  throw new Error('暂时无法生成定制编号，请稍后重试')
}

export function normalizeKeyList(value, { required = false, max = 50 } = {}) {
  if (value == null && !required) return []
  if (!Array.isArray(value)) throw new Error('素材列表格式无效')
  const keys = [...new Set(value.filter(key => typeof key === 'string' && key.startsWith('private/')))]
  if ((required && keys.length === 0) || keys.length !== value.length || keys.length > max) {
    throw new Error(`素材列表需要包含 ${required ? '1 至 ' : '不超过 '}${max} 个有效文件`)
  }
  return keys
}

export function customizationStatusLabel(status) {
  return ({
    DRAFT: '草稿',
    EXPIRING: '草稿清理中',
    SUBMITTED: '等待处理',
    REVIEWING: '正在处理',
    NEEDS_SUPPLEMENT: '需要补充素材',
    OPTIONS_READY: '待确认方案',
    UNAVAILABLE: '暂时无法制作',
    CONFIRMED: '已确认',
    CLOSED: '已关闭'
  })[status] || status
}
