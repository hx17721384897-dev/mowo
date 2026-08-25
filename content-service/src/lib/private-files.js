import crypto from 'crypto'
import path from 'path'

export const FILE_PURPOSE = Object.freeze({
  AVATAR: 'AVATAR',
  AFTERSALE_EVIDENCE: 'AFTERSALE_EVIDENCE',
  CONTACT_PORTFOLIO: 'CONTACT_PORTFOLIO',
  CONTACT_RESUME: 'CONTACT_RESUME',
  CREATOR_FRAME: 'CREATOR_FRAME',
  CUSTOMIZATION_FRAME: 'CUSTOMIZATION_FRAME',
  CUSTOMIZATION_SOURCE: 'CUSTOMIZATION_SOURCE',
  LIBRARY_SOURCE: 'LIBRARY_SOURCE',
  LIBRARY_FRAME: 'LIBRARY_FRAME',
  CONTRACT: 'CONTRACT',
  FRAME_PACK: 'FRAME_PACK'
})

const MiB = 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const POLICIES = Object.freeze({
  AVATAR: { maxBytes: 5 * MiB, types: IMAGE_TYPES.slice(0, 3), extensions: ['jpg', 'jpeg', 'png', 'webp'], public: true },
  AFTERSALE_EVIDENCE: { maxBytes: 10 * MiB, types: IMAGE_TYPES, extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] },
  CONTACT_PORTFOLIO: { maxBytes: 20 * MiB, types: [...IMAGE_TYPES, 'application/pdf'], extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf'] },
  CONTACT_RESUME: { maxBytes: 10 * MiB, types: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], extensions: ['pdf', 'doc', 'docx'] },
  CREATOR_FRAME: { maxBytes: 10 * MiB, types: IMAGE_TYPES, extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] },
  CUSTOMIZATION_FRAME: { maxBytes: 20 * MiB, types: IMAGE_TYPES, extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] },
  CUSTOMIZATION_SOURCE: { maxBytes: 200 * MiB, types: [...IMAGE_TYPES, 'video/mp4', 'video/webm', 'video/quicktime'], extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov'] },
  LIBRARY_SOURCE: { maxBytes: 200 * MiB, types: [...IMAGE_TYPES, 'video/mp4', 'video/webm', 'video/quicktime'], extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov'] },
  LIBRARY_FRAME: { maxBytes: 20 * MiB, types: IMAGE_TYPES, extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] },
  CONTRACT: { maxBytes: 20 * MiB, types: [...IMAGE_TYPES, 'application/pdf'], extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf'] },
  FRAME_PACK: { maxBytes: 200 * MiB, types: ['application/zip', 'application/x-zip-compressed'], extensions: ['zip'] }
})

const LEGACY_FOLDER_PURPOSE = Object.freeze({
  avatar: FILE_PURPOSE.AVATAR,
  aftersale: FILE_PURPOSE.AFTERSALE_EVIDENCE,
  'contact-portfolio': FILE_PURPOSE.CONTACT_PORTFOLIO,
  'contact-resumes': FILE_PURPOSE.CONTACT_RESUME,
  'creator-frames': FILE_PURPOSE.CREATOR_FRAME,
  customize: FILE_PURPOSE.CUSTOMIZATION_FRAME
})

export function normalizePurpose(purpose, folder) {
  const value = String(purpose || LEGACY_FOLDER_PURPOSE[folder] || '').toUpperCase()
  return Object.hasOwn(POLICIES, value) ? value : null
}

export function uploadPolicy(purpose) {
  return POLICIES[purpose] || null
}

export function anonymousOwnerHash(secret, token) {
  const value = String(token || '')
  if (!/^[a-zA-Z0-9_-]{20,200}$/.test(value)) return null
  return crypto.createHmac('sha256', secret).update(value).digest('hex')
}

export function validateUploadRequest({ purpose, fileName, fileType, fileSize }) {
  const policy = uploadPolicy(purpose)
  const safeName = path.basename(String(fileName || '')).slice(0, 255)
  const extension = safeName.includes('.') ? safeName.split('.').pop().toLowerCase() : ''
  const size = Number(fileSize)
  if (!policy) return '不支持的文件用途'
  if (!safeName || !extension) return '文件名或扩展名无效'
  if (!Number.isInteger(size) || size <= 0) return '无法确认文件大小'
  if (size > policy.maxBytes) return `文件不能超过 ${Math.floor(policy.maxBytes / MiB)}MB`
  if (!policy.types.includes(fileType)) return '文件类型不符合该用途'
  if (!policy.extensions.includes(extension)) return '文件扩展名不符合该用途'
  return null
}

export function detectMimeType(header) {
  const b = Buffer.from(header || [])
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6))) return 'image/gif'
  if (b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf'
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))) return 'application/msword'
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && [0x03,0x05,0x07].includes(b[2])) return 'application/zip'
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4'
  if (b.length >= 4 && b.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) return 'video/webm'
  return null
}

export function detectedTypeAllowed(purpose, detected, declared) {
  if (!detected) return false
  if (purpose === FILE_PURPOSE.CONTACT_RESUME && declared.endsWith('document') && detected === 'application/zip') return true
  if (purpose === FILE_PURPOSE.FRAME_PACK && detected === 'application/zip') return true
  if (declared === 'video/quicktime' && detected === 'video/mp4') return true
  return uploadPolicy(purpose)?.types.includes(detected) && detected === declared
}

export async function findOwnedReadyFiles(prisma, keys, userId, purposes, anonymousOwnerHash = null) {
  const uniqueKeys = [...new Set(Array.isArray(keys) ? keys.filter(item => typeof item === 'string') : [])]
  if (uniqueKeys.length !== (keys || []).length) throw new Error('附件列表包含重复或无效文件')
  if (!uniqueKeys.length) return []
  const ownership = userId ? { ownerUserId: userId } : { ownerUserId: null, anonymousOwnerHash }
  const files = await prisma.privateFile.findMany({
    where: {
      objectKey: { in: uniqueKeys }, ...ownership, purpose: { in: purposes }, status: 'READY',
      linkedResourceId: null
    }
  })
  if (files.length !== uniqueKeys.length) throw new Error('文件不存在、尚未上传完成或不属于当前账号')
  return files
}

export async function linkFiles(prisma, files, resourceType, resourceId) {
  if (!files.length) return
  await prisma.privateFile.updateMany({
    where: { id: { in: files.map(file => file.id) }, linkedResourceId: null },
    data: { linkedResourceType: resourceType, linkedResourceId: resourceId }
  })
}

const STAFF_PURPOSES = Object.freeze({
  CUSTOMER_SERVICE: new Set([
    FILE_PURPOSE.AFTERSALE_EVIDENCE,
    FILE_PURPOSE.CONTACT_PORTFOLIO,
    FILE_PURPOSE.CONTACT_RESUME,
    FILE_PURPOSE.CUSTOMIZATION_FRAME,
    FILE_PURPOSE.CUSTOMIZATION_SOURCE
  ]),
  PRODUCTION: new Set([
    FILE_PURPOSE.CUSTOMIZATION_FRAME,
    FILE_PURPOSE.CUSTOMIZATION_SOURCE,
    FILE_PURPOSE.LIBRARY_SOURCE,
    FILE_PURPOSE.LIBRARY_FRAME,
    FILE_PURPOSE.FRAME_PACK
  ]),
  COLLAB_OPS: new Set([
    FILE_PURPOSE.CONTACT_PORTFOLIO,
    FILE_PURPOSE.CREATOR_FRAME,
    FILE_PURPOSE.LIBRARY_FRAME,
    FILE_PURPOSE.CONTRACT,
    FILE_PURPOSE.FRAME_PACK
  ])
})

export function canStaffReadFile(staffRole, file) {
  if (!staffRole || !file?.linkedResourceId) return false
  if (staffRole === 'OWNER') return true
  return STAFF_PURPOSES[staffRole]?.has(file.purpose) || false
}
