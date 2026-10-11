const SECRET_KEY = /(password|pwd|otp|code|token|secret|authorization|cookie|credential)/i
const PHONE_KEY = /(phone|mobile|tel)/i
const EMAIL_KEY = /(email|e-mail)/i
const ADDRESS_KEY = /(address|receiver|recipient|consignee)/i
const SHIPPING_KEY = /(tracking|waybill|shipment)/i
const FILE_CONTENT_KEY = /(frame|image|video|attachment|document|resume|contract|content|objectKey|storageKey|fileKey|signedUrl|downloadUrl|uploadUrl)/i

function maskPhone(value) {
  const text = String(value || '')
  return /^\d{11}$/.test(text) ? `${text.slice(0, 3)}****${text.slice(-4)}` : '[REDACTED]'
}

function sanitizeValue(value, key = '', depth = 0) {
  if (depth > 5) return '[TRUNCATED]'
  if (SECRET_KEY.test(key)) return '[REDACTED]'
  if (PHONE_KEY.test(key)) return maskPhone(value)
  if (EMAIL_KEY.test(key)) return '[REDACTED]'
  if (ADDRESS_KEY.test(key) || SHIPPING_KEY.test(key) || FILE_CONTENT_KEY.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeValue(item, key, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 80).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childValue, childKey, depth + 1)
      ])
    )
  }
  if (typeof value === 'string') return value.slice(0, 500)
  return value
}

export function serializeSafeAuditBody(body) {
  if (body === undefined || body === null) return null
  try {
    return JSON.stringify(sanitizeValue(body)).slice(0, 4000)
  } catch {
    return '[UNSERIALIZABLE]'
  }
}

export function auditOutcome(statusCode) {
  if (statusCode === 401 || statusCode === 403) return 'DENIED'
  if (statusCode >= 400) return 'FAILED'
  return 'SUCCESS'
}
