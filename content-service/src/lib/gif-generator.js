/**
 * gif-generator.js
 * 下载联名作品帧图 → 合成 200×200px 5fps GIF → 上传 OSS
 * 用于 showcase.html 卡片 hover 动效
 */
import { createCanvas, loadImage } from 'canvas'
import GifEncoder from 'gif-encoder'
import { Buffer } from 'buffer'

const GIF_SIZE   = 200   // 输出尺寸 px（正方形）
const GIF_FPS    = 5     // 帧率
const GIF_DELAY  = Math.round(1000 / GIF_FPS) // ms per frame = 200
const MAX_FRAMES = 30    // 最多取前30帧，避免 GIF 过大

/**
 * 从 OSS URL 下载图片数据
 * @param {string} url - 预签名或公开 OSS URL
 * @returns {Promise<Buffer>}
 */
async function fetchImageBuffer(url) {
  const res = await fetch(url, { timeout: 15000 })
  if (!res.ok) throw new Error(`下载帧图失败: ${url} → ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * 将单帧图片渲染到 200×200 画布（居中裁切）
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('canvas').Image} img
 */
function drawFrameCentered(ctx, img) {
  const { width: iw, height: ih } = img
  const size = GIF_SIZE
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = '#111110'
  ctx.fillRect(0, 0, size, size)

  // 居中裁切（contain 风格：全部可见，按比例缩放，加黑边）
  const scale = Math.min(size / iw, size / ih)
  const sw = iw * scale
  const sh = ih * scale
  const ox = (size - sw) / 2
  const oy = (size - sh) / 2
  ctx.drawImage(img, ox, oy, sw, sh)
}

/**
 * 生成 GIF Buffer
 * @param {string[]} frameUrls - 已预签名的 OSS 帧图 URL 列表
 * @returns {Promise<Buffer>} GIF 数据
 */
async function generateGifBuffer(frameUrls) {
  const urls = frameUrls.slice(0, MAX_FRAMES)
  if (urls.length === 0) throw new Error('无帧图 URL')

  const canvas = createCanvas(GIF_SIZE, GIF_SIZE)
  const ctx    = canvas.getContext('2d')
  const encoder = new GifEncoder(GIF_SIZE, GIF_SIZE)
  const chunks  = []

  encoder.on('data', chunk => chunks.push(chunk))

  encoder.setFrameRate(GIF_FPS)
  encoder.setRepeat(0)   // 0 = 循环播放
  encoder.setQuality(10) // 1 最高质量，数字越大越快但质量越低
  encoder.writeHeader()

  let addedFrames = 0
  for (const url of urls) {
    try {
      const buf = await fetchImageBuffer(url)
      const img = await loadImage(buf)
      drawFrameCentered(ctx, img)
      encoder.setDelay(GIF_DELAY)
      encoder.addFrame(ctx)
      addedFrames++
    } catch (e) {
      // 跳过下载失败的帧，记日志即可
      console.warn('[gif-generator] 跳过帧:', url, e.message)
    }
  }

  // 若所有帧都失败（如 OSS 503），抛错不上传空 GIF，防止 hover 显示黑色
  if (addedFrames === 0) {
    throw new Error(`所有帧下载失败（共 ${urls.length} 帧），不生成 GIF`)
  }

  encoder.finish()
  return Buffer.concat(chunks)
}

/**
 * 生成 GIF 并上传到 OSS，返回 OSS objectKey
 * @param {object} opts
 * @param {string}   opts.collabWorkId
 * @param {string[]} opts.frameUrls     - 已预签名的帧图 URL
 * @param {object}   opts.oss           - Fastify OSS 客户端 (fastify.oss)
 * @returns {Promise<string>} OSS objectKey
 */
export async function generateAndUploadHoverGif({ collabWorkId, frameUrls, oss }) {
  const gifBuffer  = await generateGifBuffer(frameUrls)
  const objectKey  = `collab/hover-gif/${collabWorkId}.gif`

  await oss.put(objectKey, gifBuffer, {
    headers: { 'Content-Type': 'image/gif' }
  })

  return objectKey
}
