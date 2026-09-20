import { decompressFrames, parseGIF } from 'gifuct-js'
import { MAX_EDITOR_FRAMES, validateTrimWindow } from './source-validation'

const DEFAULT_FPS = 30
const DEFAULT_MAX_EDGE = 480
const DEFAULT_JPEG_QUALITY = 0.85
const DEFAULT_HASH_SIZE = 8
const DEFAULT_HASH_THRESHOLD = 6
const MAX_GIF_SOURCE_FRAMES = 300
const MAX_GIF_PIXELS = 16_777_216
const MAX_GIF_RENDER_PIXELS = 250_000_000

export interface ProcessedFrame {
  blob: Blob
  selected: boolean
  sourceIndex: number
  time: number | null
}

export interface ProcessingProgress {
  completed: number
  total: number
}

export interface MediaProcessingOptions {
  signal?: AbortSignal
  onProgress?: (progress: ProcessingProgress) => void
  maxFrames?: number
}

interface RawFrame extends Omit<ProcessedFrame, 'selected'> {
  hash: Uint8Array
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('素材处理已取消', 'AbortError')
}

function canvasFor(
  width: number,
  height: number
): {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
} {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('当前浏览器无法处理画面')
  return { canvas, context }
}

function scaledDimensions(width: number, height: number): [number, number] {
  if (width <= 0 || height <= 0) throw new Error('素材画面尺寸无效')
  const scale = Math.min(1, DEFAULT_MAX_EDGE / Math.max(width, height))
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('画面编码失败'))),
      'image/jpeg',
      DEFAULT_JPEG_QUALITY
    )
  })
}

export function averageHash(data: Uint8ClampedArray): Uint8Array {
  if (data.length === 0 || data.length % 4 !== 0) throw new Error('像素数据无效')
  const luminance = new Float32Array(data.length / 4)
  let total = 0
  for (let pixel = 0; pixel < luminance.length; pixel += 1) {
    const offset = pixel * 4
    const value =
      0.299 * (data[offset] ?? 0) +
      0.587 * (data[offset + 1] ?? 0) +
      0.114 * (data[offset + 2] ?? 0)
    luminance[pixel] = value
    total += value
  }
  const mean = total / luminance.length
  return Uint8Array.from(luminance, (value) => (value >= mean ? 1 : 0))
}

export function hammingDistance(left: Uint8Array, right: Uint8Array): number {
  if (left.length !== right.length) throw new Error('帧哈希长度不一致')
  let distance = 0
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) distance += 1
  }
  return distance
}

export function selectedByAdjacentHash(
  hashes: readonly Uint8Array[],
  threshold = DEFAULT_HASH_THRESHOLD
): boolean[] {
  if (!Number.isInteger(threshold) || threshold < 0) throw new Error('去重阈值无效')
  return hashes.map((hash, index) => {
    if (index === 0) return true
    return hammingDistance(hash, hashes[index - 1]!) > threshold
  })
}

export function boundedFrameIndexes(length: number, maximum = MAX_EDITOR_FRAMES): number[] {
  if (!Number.isInteger(length) || length < 0 || !Number.isInteger(maximum) || maximum <= 0) {
    throw new Error('帧数量参数无效')
  }
  if (length <= maximum) return Array.from({ length }, (_, index) => index)
  return Array.from({ length: maximum }, (_, index) => Math.floor((index * length) / maximum))
}

function frameHash(canvas: HTMLCanvasElement): Uint8Array {
  const { canvas: hashCanvas, context: hashContext } = canvasFor(
    DEFAULT_HASH_SIZE,
    DEFAULT_HASH_SIZE
  )
  hashContext.drawImage(canvas, 0, 0, DEFAULT_HASH_SIZE, DEFAULT_HASH_SIZE)
  return averageHash(hashContext.getImageData(0, 0, hashCanvas.width, hashCanvas.height).data)
}

async function seekVideo(
  video: HTMLVideoElement,
  time: number,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal)
  if (Math.abs(video.currentTime - time) < 0.0001 && video.readyState >= 2) return
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('视频定位超时'))
    }, 10_000)
    const cleanup = () => {
      window.clearTimeout(timeout)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('视频定位失败'))
    }
    const onAbort = () => {
      cleanup()
      reject(new DOMException('素材处理已取消', 'AbortError'))
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    signal?.addEventListener('abort', onAbort, { once: true })
    video.currentTime = time
  })
}

function finalizeFrames(rawFrames: readonly RawFrame[], maximum: number): ProcessedFrame[] {
  const selected = selectedByAdjacentHash(rawFrames.map((frame) => frame.hash))
  return boundedFrameIndexes(rawFrames.length, maximum).map((sourceIndex) => {
    const frame = rawFrames[sourceIndex]!
    return {
      blob: frame.blob,
      selected: selected[sourceIndex] ?? true,
      sourceIndex: frame.sourceIndex,
      time: frame.time
    }
  })
}

export async function extractVideoFrames(
  video: HTMLVideoElement,
  start: number,
  end: number,
  options: MediaProcessingOptions = {}
): Promise<ProcessedFrame[]> {
  validateTrimWindow(start, end, video.duration)
  const total = Math.max(1, Math.round((end - start) * DEFAULT_FPS))
  const [width, height] = scaledDimensions(video.videoWidth, video.videoHeight)
  const { canvas, context } = canvasFor(width, height)
  const rawFrames: RawFrame[] = []

  for (let index = 0; index < total; index += 1) {
    throwIfAborted(options.signal)
    const time = Math.min(end, start + index / DEFAULT_FPS)
    await seekVideo(video, time, options.signal)
    context.drawImage(video, 0, 0, width, height)
    rawFrames.push({
      blob: await canvasBlob(canvas),
      hash: frameHash(canvas),
      sourceIndex: index,
      time
    })
    options.onProgress?.({ completed: index + 1, total })
    if ((index + 1) % 10 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0))
  }
  throwIfAborted(options.signal)
  return finalizeFrames(rawFrames, options.maxFrames ?? MAX_EDITOR_FRAMES)
}

export async function processImageSequence(
  files: readonly File[],
  options: MediaProcessingOptions = {}
): Promise<ProcessedFrame[]> {
  if (files.length === 0) throw new Error('请选择图片素材')
  const rawFrames: RawFrame[] = []
  for (let index = 0; index < files.length; index += 1) {
    throwIfAborted(options.signal)
    const bitmap = await createImageBitmap(files[index]!)
    try {
      const [width, height] = scaledDimensions(bitmap.width, bitmap.height)
      const { canvas, context } = canvasFor(width, height)
      context.drawImage(bitmap, 0, 0, width, height)
      rawFrames.push({
        blob: await canvasBlob(canvas),
        hash: frameHash(canvas),
        sourceIndex: index,
        time: null
      })
    } finally {
      bitmap.close()
    }
    options.onProgress?.({ completed: index + 1, total: files.length })
    if ((index + 1) % 10 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0))
  }
  throwIfAborted(options.signal)
  return finalizeFrames(rawFrames, options.maxFrames ?? MAX_EDITOR_FRAMES)
}

export async function processGif(
  file: File,
  options: MediaProcessingOptions = {}
): Promise<ProcessedFrame[]> {
  throwIfAborted(options.signal)
  const parsed = parseGIF(await file.arrayBuffer())
  const width = parsed.lsd.width
  const height = parsed.lsd.height
  const frameCount = parsed.frames.filter((frame) => 'image' in frame).length
  if (width <= 0 || height <= 0 || width * height > MAX_GIF_PIXELS) {
    throw new Error('GIF 画面尺寸过大或无效')
  }
  if (
    frameCount <= 0 ||
    frameCount > MAX_GIF_SOURCE_FRAMES ||
    width * height * frameCount > MAX_GIF_RENDER_PIXELS
  ) {
    throw new Error(`GIF 帧数过多或解码规模过大（最多 ${MAX_GIF_SOURCE_FRAMES} 帧）`)
  }

  const frames = decompressFrames(parsed, true)
  const maximum = options.maxFrames ?? MAX_EDITOR_FRAMES
  const outputIndexes = new Set(boundedFrameIndexes(frames.length, maximum))
  const [outputWidth, outputHeight] = scaledDimensions(width, height)
  const { canvas: composition, context } = canvasFor(width, height)
  const { canvas: patchCanvas, context: patchContext } = canvasFor(width, height)
  const { canvas: output, context: outputContext } = canvasFor(outputWidth, outputHeight)
  const rawFrames: RawFrame[] = []

  for (let index = 0; index < frames.length; index += 1) {
    throwIfAborted(options.signal)
    const frame = frames[index]!
    const previous = frame.disposalType === 3 ? context.getImageData(0, 0, width, height) : null
    patchCanvas.width = frame.dims.width
    patchCanvas.height = frame.dims.height
    patchContext.putImageData(
      new ImageData(Uint8ClampedArray.from(frame.patch), frame.dims.width, frame.dims.height),
      0,
      0
    )
    context.drawImage(patchCanvas, frame.dims.left, frame.dims.top)

    if (outputIndexes.has(index)) {
      outputContext.clearRect(0, 0, outputWidth, outputHeight)
      outputContext.drawImage(composition, 0, 0, outputWidth, outputHeight)
      rawFrames.push({
        blob: await canvasBlob(output),
        hash: frameHash(output),
        sourceIndex: index,
        time: null
      })
    }

    if (frame.disposalType === 2) {
      context.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height)
    } else if (frame.disposalType === 3 && previous) {
      context.putImageData(previous, 0, 0)
    }
    options.onProgress?.({ completed: index + 1, total: frames.length })
    if ((index + 1) % 10 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0))
  }

  throwIfAborted(options.signal)
  return finalizeFrames(rawFrames, maximum)
}
