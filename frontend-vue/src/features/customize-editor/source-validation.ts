export const MAX_SOURCE_FILES = 50
export const MAX_SOURCE_BYTES = 200 * 1024 * 1024
export const MAX_EDITOR_FRAMES = 150
export const MIN_TRIM_SECONDS = 0.5
export const MAX_TRIM_SECONDS = 8

export type SourceKind = 'image-sequence' | 'video'

export interface ValidatedSource {
  kind: SourceKind
  files: File[]
  totalBytes: number
  videoMime: string | null
}

export type VideoSupportCheck = (mime: string) => boolean

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const VIDEO_MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime'
})

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index < 0 ? '' : name.slice(index + 1).toLowerCase()
}

function defaultVideoSupport(mime: string): boolean {
  const video = document.createElement('video')
  return video.canPlayType(mime) !== ''
}

export function validateSourceFiles(
  input: FileList | readonly File[],
  supportsVideo: VideoSupportCheck = defaultVideoSupport
): ValidatedSource {
  const files = Array.from(input)
  if (files.length === 0) throw new Error('请选择素材文件')
  if (files.length > MAX_SOURCE_FILES) throw new Error(`一次最多选择 ${MAX_SOURCE_FILES} 个文件`)

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > MAX_SOURCE_BYTES) throw new Error('素材总大小不能超过 200 MB')

  const extensions = files.map((file) => extensionOf(file.name))
  const allImages = files.every(
    (file, index) =>
      IMAGE_EXTENSIONS.has(extensions[index] ?? '') &&
      (file.type === '' || IMAGE_MIMES.has(file.type.toLowerCase()))
  )
  if (allImages) {
    return { kind: 'image-sequence', files, totalBytes, videoMime: null }
  }

  if (files.length !== 1) {
    throw new Error('图片序列只能包含 JPG、PNG 或 WEBP，且不能与视频混合选择')
  }
  const file = files[0]!
  const extension = extensions[0] ?? ''
  if (extension === 'gif' || file.type.toLowerCase() === 'image/gif') {
    throw new Error('当前浏览器版暂不支持 GIF 解帧，请转换为 MP4、WebM 或图片序列')
  }
  const expectedMime = VIDEO_MIME_BY_EXTENSION[extension]
  if (!expectedMime || (file.type !== '' && file.type.toLowerCase() !== expectedMime)) {
    throw new Error('视频素材只允许 MP4、WebM 或 MOV')
  }
  const videoMime = file.type.toLowerCase() || expectedMime
  if (!supportsVideo(videoMime)) {
    throw new Error(`当前浏览器无法解码 ${extension.toUpperCase()} 视频，请更换格式后重试`)
  }
  return { kind: 'video', files, totalBytes, videoMime }
}

export function validateTrimWindow(start: number, end: number, duration: number): void {
  if (![start, end, duration].every(Number.isFinite) || duration <= 0) {
    throw new Error('视频时长信息无效')
  }
  if (start < 0 || end > duration || end <= start) throw new Error('视频截取区间无效')
  const selectedDuration = end - start
  if (selectedDuration < MIN_TRIM_SECONDS || selectedDuration > MAX_TRIM_SECONDS) {
    throw new Error(`截取时长必须在 ${MIN_TRIM_SECONDS} 至 ${MAX_TRIM_SECONDS} 秒之间`)
  }
}

export function safeRemoteFrameUrl(value: string): string {
  const trimmed = value.trim()
  if (!/^https?:\/\//i.test(trimmed)) throw new Error('帧图片地址不受信任')
  const url = new URL(trimmed)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('帧图片地址不受信任')
  return url.href
}
