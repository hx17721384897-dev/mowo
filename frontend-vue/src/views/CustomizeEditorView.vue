<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SourcePicker from '@/features/customize-editor/SourcePicker.vue'
import FrameEditor from '@/features/customize-editor/FrameEditor.vue'
import VideoTrimPanel from '@/features/customize-editor/VideoTrimPanel.vue'
import {
  acceptReview,
  createSelfCustomizationDraft,
  createSelfScreenedProduct,
  getAssetVersionEditor,
  getDraftEditor,
  getReviewEditor,
  requestReviewRevision,
  saveAssetVersion,
  submitHumanCustomization,
  updateDraftEditor
} from '@/features/customize-editor/api'
import type {
  AssetVersionEditorData,
  DraftEditorData,
  ReviewEditorData
} from '@/features/customize-editor/api'
import { resolveEditorEntry } from '@/features/customize-editor/editor-core'
import {
  extractVideoFrames,
  processGif,
  processImageSequence,
  type ProcessedFrame
} from '@/features/customize-editor/media-processing'
import { ObjectUrlRegistry } from '@/features/customize-editor/object-url-registry'
import {
  validateSourceFiles,
  type ValidatedSource
} from '@/features/customize-editor/source-validation'
import { uploadCustomizationFiles } from '@/features/customize-editor/upload-api'
import { legacyPublicUrl } from '@/config/public-links'
import { getMachineModels } from '@/features/customize-start/api'
import type { MachineModel } from '@/features/customize-start/types'
import { useSessionStore } from '@/stores/session'
import '@/features/customize-editor/customize-editor.css'

const HUMAN_KEY = 'mowo_human_submission_key'
const HUMAN_OWNER = 'mowo_human_submission_owner'
const PRODUCT_KEY = 'mowo_custom_product_draft_key'
const PRODUCT_OWNER = 'mowo_custom_product_draft_owner'
const PRODUCT_SOURCE = 'mowo_custom_product_source_fingerprint'
const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const model = ref<MachineModel | null>(null)
const loading = ref(true)
const error = ref('')
const selfFiles = ref<File[]>([])
const humanFiles = ref<File[]>([])
const humanNote = ref('')
const humanBusy = ref(false)
const humanProgress = ref('')
const pendingHumanSubmit = ref(false)
const uploadedHumanKeys = ref<string[]>([])
const screen = ref<'upload' | 'trim' | 'processing' | 'editor'>('upload')
const sourceKind = ref<ValidatedSource['kind'] | null>(null)
const sourceUrl = ref('')
const videoDuration = ref(0)
const processedFrames = ref<ProcessedFrame[]>([])
const frameSources = ref<Array<{ source: string; selected: boolean }>>([])
const existingFrameKeys = new Map<string, string>()
const assetEditor = ref<AssetVersionEditorData | null>(null)
const draftEditor = ref<DraftEditorData | null>(null)
const reviewEditor = ref<ReviewEditorData | null>(null)
const existingBusy = ref(false)
const existingProgress = ref('')
const processingProgress = ref(0)
const selfBusy = ref(false)
const selfProgress = ref('')
const trimStart = ref(0)
const trimEnd = ref(0)
const pendingSelfSubmit = ref<{ sources: string[]; indexes: number[] } | null>(null)
const ratioWarning = ref<{
  actual: string
  suggested: string
  resolve: (accepted: boolean) => void
} | null>(null)
const objectUrls = new ObjectUrlRegistry()
const blobByUrl = new Map<string, Blob>()
let uploadedSelfFrameKeys: string[] = []
let uploadedSelfSourceKeys: string[] = []
let savedSelfProductId = ''
const entry = computed(() =>
  resolveEditorEntry(new URLSearchParams(route.query as Record<string, string>))
)
const editorTargets = computed(() => {
  if (entry.value.mode === 'asset-version') return []
  if (entry.value.mode === 'customer-review') return reviewEditor.value?.model.frameOptions ?? []
  return model.value
    ? [...new Set(model.value.skus.map((sku) => sku.frameCount))].sort((a, b) => a - b)
    : []
})
const editorReady = computed(() => entry.value.mode !== 'new-customization' || Boolean(model.value))
const editorReadOnly = computed(() => entry.value.mode === 'customer-review')
const editorNextLabel = computed(() => {
  if (entry.value.mode === 'asset-version')
    return assetEditor.value ? `保存为 V${assetEditor.value.version.versionNo + 1}` : '保存新版本'
  if (entry.value.mode === 'customer-review')
    return reviewEditor.value?.request.status === 'OPTIONS_READY'
      ? '满意，选择款式 →'
      : '继续选择款式 →'
  return '下一步 →'
})
const editorBackLabel = computed(() =>
  entry.value.mode === 'new-customization' ? '← 重新上传' : '← 返回列表'
)

interface SourceInspection {
  sourceCount: number
  totalBytes: number
  formats: string[]
  width: number | null
  height: number | null
  duration: number | null
  ratioOk: boolean | null
  ratioActual: string | null
  ratioSuggested: string
}
const humanScreening = ref<SourceInspection | null>(null)

function clearSelfDraftKeys(): void {
  uploadedSelfFrameKeys = []
  uploadedSelfSourceKeys = []
  savedSelfProductId = ''
  sessionStorage.removeItem(PRODUCT_KEY)
  sessionStorage.removeItem(PRODUCT_OWNER)
  sessionStorage.removeItem(PRODUCT_SOURCE)
  sessionStorage.removeItem('mowo_customize_request_draft_key')
  sessionStorage.removeItem('mowo_customize_request_draft_owner')
}

function sourceFingerprint(files: readonly File[]): string {
  return JSON.stringify(
    files.map((file) => [file.name, file.size, file.type, file.lastModified] as const)
  )
}

function bindSelfDraftToFiles(files: readonly File[]): void {
  const fingerprint = sourceFingerprint(files)
  if (sessionStorage.getItem(PRODUCT_SOURCE) !== fingerprint) clearSelfDraftKeys()
  sessionStorage.setItem(PRODUCT_SOURCE, fingerprint)
}

function assessRatio(
  width: number,
  height: number
): {
  ok: boolean | null
  actual: string | null
  suggested: string
} {
  const ratios = model.value?.ratios ?? []
  if (!width || !height || !ratios.length)
    return { ok: null, actual: null, suggested: ratios.join(' 或 ') }
  const actual = width / height
  const matches = ratios.some((ratio) => {
    const [ratioWidth, ratioHeight] = ratio.split(':').map(Number)
    const expected = ratioWidth! / ratioHeight!
    return Number.isFinite(expected) && Math.abs(actual - expected) / expected <= 0.1
  })
  if (matches) return { ok: true, actual: null, suggested: ratios.join(' 或 ') }
  return {
    ok: false,
    actual: width >= height ? `${actual.toFixed(2)}:1` : `1:${(1 / actual).toFixed(2)}`,
    suggested: ratios.join(' 或 ')
  }
}

async function inspectSource(files: File[], validated: ValidatedSource): Promise<SourceInspection> {
  let width: number | null = null
  let height: number | null = null
  let duration: number | null = null
  if (validated.kind === 'video') {
    const url = URL.createObjectURL(files[0]!)
    const video = document.createElement('video')
    video.preload = 'metadata'
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve()
        video.onerror = () => reject(new Error('视频无法读取，请更换格式后重试'))
        video.src = url
      })
      width = video.videoWidth || null
      height = video.videoHeight || null
      duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
    } finally {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
  } else {
    const bitmap = await createImageBitmap(files[0]!)
    width = bitmap.width
    height = bitmap.height
    bitmap.close()
  }
  const ratio = width && height ? assessRatio(width, height) : assessRatio(0, 0)
  return {
    sourceCount: files.length,
    totalBytes: validated.totalBytes,
    formats: [...new Set(files.map((file) => file.type || file.name.split('.').pop() || ''))],
    width,
    height,
    duration,
    ratioOk: ratio.ok,
    ratioActual: ratio.actual,
    ratioSuggested: ratio.suggested
  }
}

function confirmRatio(actual: string, suggested: string): Promise<boolean> {
  return new Promise((resolve) => {
    ratioWarning.value = { actual, suggested, resolve }
  })
}

function closeRatioWarning(accepted: boolean): void {
  const warning = ratioWarning.value
  ratioWarning.value = null
  warning?.resolve(accepted)
}

function writeCompatibilityStorage(entries: ReadonlyArray<readonly [string, string]>): void {
  try {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  } catch {
    // 云端草稿和网址 requestId 才是事实源；兼容缓存写满时不得重复提交或阻断后续确认页。
  }
}

async function assignFiles(target: 'self' | 'human', files: File[]): Promise<void> {
  try {
    const validated = validateSourceFiles(files)
    const inspection = await inspectSource(files, validated)
    if (
      target === 'self' &&
      inspection.ratioOk === false &&
      !(await confirmRatio(inspection.ratioActual!, inspection.ratioSuggested))
    ) {
      return
    }
    if (target === 'self') {
      bindSelfDraftToFiles(files)
      selfFiles.value = files
    } else {
      humanFiles.value = files
      humanScreening.value = inspection
      uploadedHumanKeys.value = []
    }
    error.value = ''
  } catch (cause) {
    window.alert(cause instanceof Error ? cause.message : '素材格式不正确')
  }
}

function clearHuman(): void {
  humanFiles.value = []
  uploadedHumanKeys.value = []
  humanNote.value = ''
  humanScreening.value = null
  sessionStorage.removeItem(HUMAN_KEY)
  sessionStorage.removeItem(HUMAN_OWNER)
}

function clearSelfSelection(): void {
  selfFiles.value = []
  clearSelfDraftKeys()
}

function requestLogin(): void {
  pendingHumanSubmit.value = true
  void router.replace({
    query: {
      ...route.query,
      auth: '1',
      redirect: route.fullPath.replace(/([?&])auth=1(&|$)/, '$1')
    }
  })
}

function requestKey(ownerId: string): string {
  const storedOwner = sessionStorage.getItem(HUMAN_OWNER)
  let key = sessionStorage.getItem(HUMAN_KEY)
  if (!key || storedOwner !== ownerId) {
    key = crypto.randomUUID()
    sessionStorage.setItem(HUMAN_KEY, key)
    sessionStorage.setItem(HUMAN_OWNER, ownerId)
  }
  return key
}

async function submitHuman(): Promise<void> {
  if (!humanFiles.value.length || humanBusy.value || !model.value) return
  await session.bootstrap()
  if (!session.isAuthenticated || !session.user?.id) {
    requestLogin()
    return
  }
  if (
    !window.confirm(
      '提交后会进入人工筛选和制作可行性审核，不会立即生成可支付订单。工作人员处理后，结果会显示在“我的定制”。确认提交吗？'
    )
  ) {
    return
  }

  humanBusy.value = true
  try {
    if (!uploadedHumanKeys.value.length) {
      uploadedHumanKeys.value = await uploadCustomizationFiles(
        humanFiles.value,
        'CUSTOMIZATION_SOURCE',
        (completed, total) => {
          humanProgress.value = `上传素材 ${completed}/${total}`
        }
      )
    }
    humanProgress.value = '正在提交'
    const result = await submitHumanCustomization({
      machineModelId: model.value.id,
      sourceKeys: uploadedHumanKeys.value,
      clientRequestKey: requestKey(session.user.id),
      screeningData: humanScreening.value ?? {},
      userNote: humanNote.value
    })
    localStorage.removeItem('mowo_customize_request_draft_id')
    sessionStorage.removeItem(HUMAN_KEY)
    sessionStorage.removeItem(HUMAN_OWNER)
    await router.push({ name: 'my-customizations', query: { submitted: result.requestNo } })
  } catch (cause) {
    window.alert(`提交失败：${cause instanceof Error ? cause.message : '请稍后重试'}`)
  } finally {
    humanBusy.value = false
    humanProgress.value = ''
  }
}

async function startSelfScreening(): Promise<void> {
  if (!selfFiles.value.length) return
  const validated = validateSourceFiles(selfFiles.value)
  sourceKind.value = validated.kind
  if (validated.kind === 'image-sequence') {
    await processImages()
    return
  }
  if (validated.kind === 'gif') {
    await processGifSource()
    return
  }
  sourceUrl.value = objectUrls.create(selfFiles.value[0]!)
  const probe = document.createElement('video')
  probe.preload = 'metadata'
  probe.src = sourceUrl.value
  try {
    await new Promise<void>((resolve, reject) => {
      probe.onloadedmetadata = () => resolve()
      probe.onerror = () => reject(new Error('视频无法读取，请更换格式后重试'))
    })
    videoDuration.value = await resolveVideoDuration(probe)
    screen.value = 'trim'
  } catch (cause) {
    window.alert(cause instanceof Error ? cause.message : '视频无法读取')
    reupload()
  }
}

async function resolveVideoDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    if (video.duration < 0.5) throw new Error('视频有效时长不足 0.5 秒')
    return video.duration
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('视频缺少可读取的时长信息，请转换格式后重试'))
    }, 5_000)
    const cleanup = () => {
      window.clearTimeout(timeout)
      video.removeEventListener('durationchange', changed)
      video.removeEventListener('error', failed)
    }
    const changed = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return
      cleanup()
      resolve()
    }
    const failed = () => {
      cleanup()
      reject(new Error('视频时长读取失败'))
    }
    video.addEventListener('durationchange', changed)
    video.addEventListener('error', failed, { once: true })
    video.currentTime = Number.MAX_SAFE_INTEGER
  })
  const duration = video.duration
  video.currentTime = 0
  if (!Number.isFinite(duration) || duration < 0.5) {
    throw new Error('视频有效时长不足 0.5 秒')
  }
  return duration
}

function enterEditor(frames: ProcessedFrame[]): void {
  processedFrames.value = frames
  frameSources.value = frames.map((frame) => {
    const url = objectUrls.create(frame.blob)
    blobByUrl.set(url, frame.blob)
    return { source: url, selected: frame.selected }
  })
  screen.value = 'editor'
}

async function processImages(): Promise<void> {
  screen.value = 'processing'
  processingProgress.value = 0
  try {
    enterEditor(
      await processImageSequence(selfFiles.value, {
        onProgress: ({ completed, total }) => {
          processingProgress.value = Math.round((completed / total) * 100)
        }
      })
    )
  } catch (cause) {
    window.alert(cause instanceof Error ? cause.message : '图片处理失败')
    reupload()
  }
}

async function processGifSource(): Promise<void> {
  screen.value = 'processing'
  processingProgress.value = 0
  try {
    enterEditor(
      await processGif(selfFiles.value[0]!, {
        onProgress: ({ completed, total }) => {
          processingProgress.value = Math.round((completed / total) * 100)
        }
      })
    )
  } catch (cause) {
    window.alert(cause instanceof Error ? cause.message : 'GIF 处理失败')
    reupload()
  }
}

async function processVideo(start: number, end: number): Promise<void> {
  trimStart.value = start
  trimEnd.value = end
  screen.value = 'processing'
  const video = document.createElement('video')
  video.preload = 'auto'
  video.src = sourceUrl.value
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('视频无法解码'))
    })
    await resolveVideoDuration(video)
    enterEditor(
      await extractVideoFrames(video, start, end, {
        onProgress: ({ completed, total }) => {
          processingProgress.value = Math.round((completed / total) * 100)
        }
      })
    )
  } catch (cause) {
    window.alert(cause instanceof Error ? cause.message : '视频抽帧失败')
    screen.value = 'trim'
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
}

function reupload(): void {
  screen.value = 'upload'
  processedFrames.value = []
  frameSources.value = []
  sourceKind.value = null
  sourceUrl.value = ''
  blobByUrl.clear()
  objectUrls.releaseAll()
  clearSelfDraftKeys()
}

function selfDraftKey(ownerId: string): string {
  const ownerKey = 'mowo_customize_request_draft_owner'
  const keyName = 'mowo_customize_request_draft_key'
  let key = sessionStorage.getItem(keyName)
  if (!key || sessionStorage.getItem(ownerKey) !== ownerId) {
    key = crypto.randomUUID()
    sessionStorage.setItem(keyName, key)
    sessionStorage.setItem(ownerKey, ownerId)
  }
  return key
}

function productDraftKey(ownerId: string): string {
  let key = sessionStorage.getItem(PRODUCT_KEY)
  if (!key || sessionStorage.getItem(PRODUCT_OWNER) !== ownerId) {
    key = crypto.randomUUID()
    sessionStorage.setItem(PRODUCT_KEY, key)
    sessionStorage.setItem(PRODUCT_OWNER, ownerId)
  }
  return key
}

async function submitSelf(sources: string[], indexes: number[]): Promise<void> {
  if (!model.value || selfBusy.value) return
  await session.bootstrap()
  if (!session.isAuthenticated || !session.user?.id) {
    pendingSelfSubmit.value = { sources, indexes }
    void router.replace({ query: { ...route.query, auth: '1', redirect: route.fullPath } })
    return
  }
  selfBusy.value = true
  try {
    const frameFiles = sources.map(
      (source, index) =>
        new File([blobByUrl.get(source)!], `frame-${String(index + 1).padStart(3, '0')}.jpg`, {
          type: 'image/jpeg'
        })
    )
    if (!uploadedSelfFrameKeys.length) {
      uploadedSelfFrameKeys = await uploadCustomizationFiles(
        frameFiles,
        'CUSTOMIZATION_FRAME',
        (done, total) => {
          selfProgress.value = `上传帧图 ${done}/${total}`
        }
      )
    }
    const targets = [...new Set(model.value.skus.map((sku) => sku.frameCount))].filter(
      (target) => target >= sources.length && target % sources.length === 0
    )
    if (!savedSelfProductId) {
      const product = await createSelfScreenedProduct({
        clientDraftKey: productDraftKey(session.user.id),
        frameKeys: uploadedSelfFrameKeys,
        frameCount: sources.length,
        modelId: model.value.id,
        modelName: model.value.name,
        selectedIndexes: indexes,
        trimStart: trimStart.value,
        trimEnd: trimEnd.value
      })
      savedSelfProductId = product.id
      uploadedSelfFrameKeys = product.frameKeys
    }
    writeCompatibilityStorage([['mowo_customize_draft_id', savedSelfProductId]])
    if (!uploadedSelfSourceKeys.length) {
      uploadedSelfSourceKeys = await uploadCustomizationFiles(
        selfFiles.value,
        'CUSTOMIZATION_SOURCE',
        (done, total) => {
          selfProgress.value = `上传原素材 ${done}/${total}`
        }
      )
    }
    const requestId = await createSelfCustomizationDraft({
      clientDraftKey: selfDraftKey(session.user.id),
      customProductId: savedSelfProductId,
      machineModelId: model.value.id,
      sourceKeys: uploadedSelfSourceKeys,
      selectedFrameKeys: uploadedSelfFrameKeys,
      selectedIndexes: indexes,
      validTargets: targets,
      trimStart: trimStart.value,
      trimEnd: trimEnd.value
    })
    writeCompatibilityStorage([
      ['mowo_customize_frame_keys', JSON.stringify(uploadedSelfFrameKeys)],
      ['mowo_customize_frame_owner', session.user.id],
      ['mowo_customize_request_draft_id', requestId]
    ])
    try {
      localStorage.removeItem('mowo_customize_human_request_id')
    } catch {
      // requestId 查询参数优先于旧人工编号，存储不可写时仍可安全继续。
    }
    sessionStorage.removeItem(PRODUCT_KEY)
    sessionStorage.removeItem(PRODUCT_OWNER)
    sessionStorage.removeItem(PRODUCT_SOURCE)
    sessionStorage.removeItem('mowo_customize_request_draft_key')
    sessionStorage.removeItem('mowo_customize_request_draft_owner')
    const next = new URL(legacyPublicUrl('customize-confirm'), window.location.origin)
    next.searchParams.set('type', model.value.modelType || 'single')
    next.searchParams.set('modelId', model.value.id)
    next.searchParams.set('modelName', model.value.name)
    next.searchParams.set('frames', String(sources.length))
    next.searchParams.set('targets', targets.join(','))
    next.searchParams.set('requestId', requestId)
    window.location.assign(next)
  } catch (cause) {
    window.alert(`上传失败：${cause instanceof Error ? cause.message : '请重试'}`)
  } finally {
    selfBusy.value = false
    selfProgress.value = ''
  }
}

function existingVersionKey(asset: AssetVersionEditorData): string {
  const name = `mowo_asset_version_key_${asset.asset.id}_${asset.version.id}`
  let value = sessionStorage.getItem(name)
  if (!value) {
    value = crypto.randomUUID()
    sessionStorage.setItem(name, value)
  }
  return value
}

async function submitExisting(sources: string[], indexes: number[]): Promise<void> {
  if (existingBusy.value) return
  existingBusy.value = true
  try {
    if (entry.value.mode === 'draft-edit' && draftEditor.value) {
      const data = draftEditor.value
      const frameKeys = sources.map((source) => existingFrameKeys.get(source))
      if (frameKeys.some((key) => !key)) throw new Error('草稿帧图来源不完整，请刷新后重试')
      const requestId = await updateDraftEditor({
        draftId: data.id,
        frameKeys: frameKeys as string[],
        selectedIndexes: indexes
      })
      writeCompatibilityStorage([['mowo_customize_draft_id', data.id]])
      if (requestId) writeCompatibilityStorage([['mowo_customize_request_draft_id', requestId]])
      const next = new URL(legacyPublicUrl('customize-confirm'), window.location.origin)
      next.searchParams.set('modelId', model.value?.id ?? '')
      next.searchParams.set('frames', String(frameKeys.length))
      next.searchParams.set(
        'targets',
        editorTargets.value
          .filter((value) => value >= frameKeys.length && value % frameKeys.length === 0)
          .join(',')
      )
      if (requestId) next.searchParams.set('requestId', requestId)
      window.location.assign(next)
      return
    }
    if (entry.value.mode === 'asset-version' && assetEditor.value) {
      const data = assetEditor.value
      const keyName = `mowo_asset_version_key_${data.asset.id}_${data.version.id}`
      const frameKeys = sources.map((source) => existingFrameKeys.get(source))
      if (frameKeys.some((key) => !key)) throw new Error('动画帧图来源不完整，请刷新后重试')
      const versionNo = await saveAssetVersion({
        assetId: data.asset.id,
        baseVersionId: data.version.id,
        clientVersionKey: existingVersionKey(data),
        frameKeys: frameKeys as string[],
        selectedIndexes: indexes
      })
      sessionStorage.removeItem(keyName)
      await router.push(
        `/account/animations?updated=${encodeURIComponent(data.asset.id)}&version=${versionNo}`
      )
      return
    }
    if (entry.value.mode === 'customer-review' && reviewEditor.value) {
      const data = reviewEditor.value
      if (data.request.status === 'OPTIONS_READY') await acceptReview(data.request.id)
      writeCompatibilityStorage([
        [
          'mowo_customize_frame_keys',
          JSON.stringify(data.selection.frames.map((frame) => frame.key))
        ],
        ['mowo_customize_human_request_id', data.request.id],
        ...(data.request.customProductId
          ? [['mowo_customize_draft_id', data.request.customProductId] as const]
          : [])
      ])
      const next = new URL(legacyPublicUrl('customize-confirm'), window.location.origin)
      next.searchParams.set('type', data.model.modelType)
      next.searchParams.set('modelId', data.model.id)
      next.searchParams.set('modelName', data.model.name)
      next.searchParams.set('frames', String(data.selection.frames.length))
      next.searchParams.set(
        'targets',
        editorTargets.value
          .filter(
            (value) =>
              value >= data.selection.frames.length && value % data.selection.frames.length === 0
          )
          .join(',')
      )
      next.searchParams.set('humanRequestId', data.request.id)
      window.location.assign(next)
    }
  } catch (cause) {
    window.alert(cause instanceof Error ? cause.message : '保存失败，请重试')
  } finally {
    existingBusy.value = false
    existingProgress.value = ''
  }
}

function handleEditorNext(sources: string[], indexes: number[]): void {
  if (entry.value.mode === 'new-customization') void submitSelf(sources, indexes)
  else void submitExisting(sources, indexes)
}

async function reviseReview(): Promise<void> {
  if (!reviewEditor.value || reviewEditor.value.request.status !== 'OPTIONS_READY') return
  const message = window.prompt('请告诉工作人员需要调整什么：')?.trim()
  if (!message) return
  try {
    await requestReviewRevision(reviewEditor.value.request.id, message)
    await router.push('/account/customizations')
  } catch (cause) {
    window.alert(cause instanceof Error ? cause.message : '提交失败，请重试')
  }
}

function leaveExistingEditor(): void {
  if (entry.value.mode === 'customer-review') void router.push('/account/customizations')
  else void router.push('/account/animations')
}

async function load(): Promise<void> {
  loading.value = true
  try {
    if (['asset-version', 'customer-review', 'draft-edit'].includes(entry.value.mode)) {
      await session.bootstrap()
      if (!session.isAuthenticated) {
        void router.replace({ query: { ...route.query, auth: '1', redirect: route.fullPath } })
        throw new Error('请先登录后继续')
      }
      existingFrameKeys.clear()
      if (entry.value.mode === 'draft-edit') {
        const data = await getDraftEditor(entry.value.resourceId!)
        draftEditor.value = data
        data.frames.forEach((frame) => existingFrameKeys.set(frame.url, frame.key))
        frameSources.value = data.frames.map((frame) => ({ source: frame.url, selected: true }))
        if (!data.machineModelId) throw new Error('草稿没有关联可用款式，请重新开始定制')
        const models = await getMachineModels()
        model.value = models.find((item) => item.id === data.machineModelId) ?? null
        if (!model.value) throw new Error('草稿关联款式已下架，请重新开始定制')
      } else if (entry.value.mode === 'asset-version') {
        const data = await getAssetVersionEditor(entry.value.resourceId!)
        assetEditor.value = data
        data.version.frames.forEach((frame) => existingFrameKeys.set(frame.url, frame.key))
        frameSources.value = data.version.frames.map((frame) => ({
          source: frame.url,
          selected: true
        }))
      } else {
        const data = await getReviewEditor(entry.value.resourceId!)
        reviewEditor.value = data
        data.selection.frames.forEach((frame) => existingFrameKeys.set(frame.url, frame.key))
        frameSources.value = data.selection.frames.map((frame) => ({
          source: frame.url,
          selected: true
        }))
      }
      screen.value = 'editor'
      return
    }
    if (entry.value.mode !== 'new-customization') throw new Error('该编辑模式尚未迁移')
    if (!entry.value.modelId) throw new Error('没有找到已选款式，请返回上一步重新选择')
    const models = await getMachineModels()
    model.value = models.find((item) => item.id === entry.value.modelId) ?? null
    if (!model.value) throw new Error('所选款式不存在或暂不可用，请返回上一步重新选择')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '编辑器加载失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => session.isAuthenticated,
  (authenticated) => {
    if (authenticated && pendingHumanSubmit.value) {
      pendingHumanSubmit.value = false
      void submitHuman()
    } else if (authenticated && pendingSelfSubmit.value) {
      const pending = pendingSelfSubmit.value
      pendingSelfSubmit.value = null
      void submitSelf(pending.sources, pending.indexes)
    } else if (authenticated && entry.value.mode !== 'new-customization') {
      void load()
    }
  }
)

onMounted(() => void load())
onBeforeUnmount(() => {
  pendingHumanSubmit.value = false
  closeRatioWarning(false)
  objectUrls.releaseAll()
})
</script>

<template>
  <div class="customize-editor-page">
    <div class="progress-steps">
      <RouterLink class="progress-back" to="/customize" aria-label="返回选型号">
        <span class="progress-back-arrow" aria-hidden="true">←</span>
        <span class="progress-back-label">返回选型号</span>
      </RouterLink>
      <div class="step-item done">
        <div class="step-num">1</div>
        <span class="step-label">选型号</span>
      </div>
      <div class="step-divider"></div>
      <div class="step-item active">
        <div class="step-num">2</div>
        <span class="step-label">上传 &amp; 筛帧</span>
      </div>
      <div class="step-divider"></div>
      <div class="step-item">
        <div class="step-num">3</div>
        <span class="step-label">选款式</span>
      </div>
      <div class="step-divider"></div>
      <div class="step-item">
        <div class="step-num">4</div>
        <span class="step-label">确认 &amp; 购买</span>
      </div>
    </div>

    <main v-if="screen === 'upload'" id="stateUpload">
      <p v-if="loading" class="editor-status">正在确认所选款式…</p>
      <div v-else-if="error" class="editor-status editor-error">
        <p>{{ error }}</p>
        <RouterLink class="btn btn-secondary btn-sm" to="/customize">返回选择款式</RouterLink>
      </div>
      <template v-else>
        <div class="upload-header">
          <p class="upload-eyebrow">第二步 · 共四步</p>
          <h1 class="upload-title">选择素材<em>处理方式</em></h1>
          <p class="upload-sub">你可以自己完成筛帧，也可以把原素材交给工作人员处理。</p>
        </div>
        <div class="upload-method-grid">
          <section class="upload-method self">
            <div class="method-head">
              <div>
                <p class="method-kicker">较快完成</p>
                <h2 class="method-title">我自己筛选</h2>
                <p class="method-desc">
                  进入现有编辑器，自行裁剪、抽帧并预览，完成后选择款式并提交订单。
                </p>
              </div>
              <div class="method-icon">✂</div>
            </div>
            <SourcePicker
              :files="selfFiles"
              title="上传并自己筛选"
              subtitle="拖拽文件，或点击选择"
              icon="🎞"
              accessible-label="选择自己筛选的素材"
              video-label="MP4"
              image-label="图片"
              @select="assignFiles('self', $event)"
              @clear="clearSelfSelection"
            />
            <div class="method-actions">
              <button
                class="btn btn-yellow"
                type="button"
                :disabled="!selfFiles.length"
                @click="startSelfScreening"
              >
                开始筛选 →
              </button>
            </div>
          </section>

          <section class="upload-method human">
            <div class="method-head">
              <div>
                <p class="method-kicker">人工协助</p>
                <h2 class="method-title">请工作人员帮我筛选</h2>
                <p class="method-desc">
                  提交原始素材和期望，工作人员处理后会在“我的定制”返回结果。
                </p>
              </div>
              <div class="method-icon">☷</div>
            </div>
            <SourcePicker
              :files="humanFiles"
              title="上传原始素材"
              subtitle="视频、GIF 或一组图片"
              icon="＋"
              accessible-label="选择提交给工作人员的素材"
              video-label="视频"
              image-label="图片"
              @select="assignFiles('human', $event)"
              @clear="clearHuman"
            />
            <div v-if="humanFiles.length" class="human-form visible">
              <textarea
                v-model="humanNote"
                class="human-note"
                maxlength="1000"
                placeholder="希望保留的片段、画面重点或其他说明（选填)"
              ></textarea>
              <p v-if="humanScreening?.ratioOk === false" class="human-screening">
                画面比例约为 {{ humanScreening.ratioActual }}，工作人员会结合
                {{ humanScreening.ratioSuggested }} 款式判断。
              </p>
              <div class="method-delay">
                <span>◷</span><span>人工筛选不会立即完成，提交后可凭定制编号查看处理进度。</span>
              </div>
              <div class="method-actions">
                <button
                  class="btn btn-primary"
                  type="button"
                  :disabled="humanBusy"
                  @click="submitHuman"
                >
                  {{ humanProgress || '提交人工处理' }}
                </button>
              </div>
            </div>
          </section>
        </div>
      </template>
    </main>
    <div v-if="screen === 'editor' && assetEditor" class="editor-mode-banner">
      正在修改 {{ assetEditor.asset.title }}（{{ assetEditor.asset.assetNo }} · V{{
        assetEditor.version.versionNo
      }}），旧版本会继续保留
    </div>
    <div v-if="screen === 'editor' && draftEditor" class="editor-mode-banner">
      正在重新编辑草稿；保存时更新原草稿，不会新建重复记录
    </div>
    <div v-if="screen === 'editor' && reviewEditor" class="editor-mode-banner">
      确认筛帧 · {{ reviewEditor.request.requestNo }} · 第 {{ reviewEditor.selection.version }} 版
      <span v-if="reviewEditor.selection.staffMessage">
        · {{ reviewEditor.selection.staffMessage }}</span
      >
      <button
        v-if="reviewEditor.request.status === 'OPTIONS_READY'"
        type="button"
        class="btn btn-secondary btn-sm"
        @click="reviseReview"
      >
        需要调整
      </button>
    </div>
    <VideoTrimPanel
      v-else-if="screen === 'trim'"
      :source="sourceUrl"
      :duration="videoDuration"
      @confirm="processVideo"
      @cancel="reupload"
    />
    <main v-else-if="screen === 'processing'" id="stateLoading" class="active">
      <span class="loading-anim">⚙️</span>
      <p class="loading-title">正在提取帧…</p>
      <p class="loading-sub">我们正在把文件拆解成一帧一帧的图片，请稍候。</p>
      <div class="loading-bar-wrap">
        <div class="loading-bar-track">
          <div class="loading-bar-fill" :style="{ width: `${processingProgress}%` }"></div>
        </div>
        <div class="loading-bar-labels">
          <span>正在处理素材…</span><strong>{{ processingProgress }}%</strong>
        </div>
      </div>
      <div class="loading-tips">
        <div class="loading-tip">
          <span class="loading-tip-icon">⏱</span>
          <p>文件越大等待越久，请勿关闭当前页面。</p>
        </div>
        <div class="loading-tip">
          <span class="loading-tip-icon">✂️</span>
          <p>下次可先裁剪视频再上传，只保留想要的片段，速度会快很多。</p>
        </div>
        <div class="loading-tip">
          <span class="loading-tip-icon">🎞</span>
          <p>提取完成后你可以手动筛帧，选出最终要使用的帧。</p>
        </div>
      </div>
    </main>
    <FrameEditor
      v-if="screen === 'editor' && editorReady"
      :frames="frameSources"
      :targets="editorTargets"
      :busy="entry.mode === 'new-customization' ? selfBusy : existingBusy"
      :progress="entry.mode === 'new-customization' ? selfProgress : existingProgress"
      :read-only="editorReadOnly"
      :allow-any-frame-count="entry.mode === 'asset-version'"
      :next-label="editorNextLabel"
      :back-label="editorBackLabel"
      @next="handleEditorNext"
      @reupload="entry.mode === 'new-customization' ? reupload() : leaveExistingEditor()"
    />
    <div v-if="ratioWarning" class="ratio-warning-overlay" role="dialog" aria-modal="true">
      <div class="ratio-warning-card">
        <div class="ratio-warning-icon" aria-hidden="true">⚠️</div>
        <p class="ratio-warning-title">图片比例不符合要求</p>
        <p class="ratio-warning-copy">
          检测到您上传的内容比例约为
          <strong>{{ ratioWarning.actual }}</strong
          >，<br />
          当前机型支持的比例为 <b>{{ ratioWarning.suggested }}</b
          >。<br />
          建议裁剪后重新上传，效果更佳。
        </p>
        <div class="ratio-warning-actions">
          <button type="button" class="ratio-force" @click="closeRatioWarning(true)">
            强制使用
          </button>
          <button type="button" class="ratio-cancel" @click="closeRatioWarning(false)">
            重新上传
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
