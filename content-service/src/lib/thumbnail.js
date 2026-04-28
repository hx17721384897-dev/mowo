/**
 * thumbnail.js
 * 从帧图 data URI 生成 200×200 JPEG 缩略图 data URI（约 10~30KB）
 * 用于 collab_works.coverUrl 存储，前端直接渲染，无需 OSS 预签名
 */
import { createCanvas, loadImage } from 'canvas'

const THUMB_SIZE    = 200
const THUMB_QUALITY = 0.65   // JPEG 压缩质量，约 10~30KB

/**
 * 将第一帧 data URI 压缩成 200×200 缩略图 data URI
 * @param {string} dataUri  - 形如 "data:image/jpeg;base64,..."
 * @returns {Promise<string>} 压缩后的 data URI（data:image/jpeg;base64,...）
 */
export async function generateCoverThumb(dataUri) {
  const img    = await loadImage(dataUri)
  const canvas = createCanvas(THUMB_SIZE, THUMB_SIZE)
  const ctx    = canvas.getContext('2d')

  // 黑色背景
  ctx.fillStyle = '#111110'
  ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE)

  // contain 缩放居中
  const { width: iw, height: ih } = img
  const scale = Math.min(THUMB_SIZE / iw, THUMB_SIZE / ih)
  const sw = iw * scale
  const sh = ih * scale
  const ox = (THUMB_SIZE - sw) / 2
  const oy = (THUMB_SIZE - sh) / 2
  ctx.drawImage(img, ox, oy, sw, sh)

  const buf = canvas.toBuffer('image/jpeg', { quality: THUMB_QUALITY })
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}
