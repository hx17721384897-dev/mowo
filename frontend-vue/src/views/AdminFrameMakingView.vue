<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent, vue/multiline-html-element-content-newline */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminSidebar from '@/components/AdminSidebar.vue'
import {
  abandonFrameDraft,
  createFrameDraft,
  getFrameDraft,
  listFrameDrafts,
  publishFrameDraft,
  submitFrameDraft,
  updateFrameDraft,
  uploadFrameMakingFile,
  type FrameDraftDetail,
  type FrameDraftListItem,
  type FrameDraftStatus,
  type FrameSourceType
} from '@/features/admin-frame-making/api'
import {
  averageHash,
  extractVideoFrames,
  hammingDistance,
  processGif,
  processImageSequence,
  type ProcessedFrame
} from '@/features/customize-editor/media-processing'
import { ObjectUrlRegistry } from '@/features/customize-editor/object-url-registry'
import { validateSourceFiles } from '@/features/customize-editor/source-validation'
import { useSessionStore } from '@/stores/session'
import './admin-frame-making.css'

type Screen = 'home' | 'import' | 'trim' | 'processing' | 'editor' | 'meta'
const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const collapsed = ref(false)
const mobileOpen = ref(false)
const screen = ref<Screen>('home')
const draftStatus = ref<FrameDraftStatus>('DRAFT')
const drafts = ref<FrameDraftListItem[]>([])
const draft = ref<FrameDraftDetail | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const saveState = ref('')
const files = ref<File[]>([])
const sourceType = ref<FrameSourceType>('IMAGES')
const ratio = ref('1:1')
const title = ref('')
const uploadDone = ref(0)
const uploadedSourceKeys = ref<string[]>([])
const processingDone = ref(0)
const processingTotal = ref(0)
const videoUrl = ref('')
const videoDuration = ref(0)
const trimStart = ref(0)
const trimEnd = ref(0)
const video = ref<HTMLVideoElement | null>(null)
const candidates = ref<ProcessedFrame[]>([])
const candidateUrls = ref<string[]>([])
const selectedOrder = ref<number[]>([])
const selectionHistory = ref<number[][]>([])
const previewPosition = ref(0)
const playbackMs = ref(220)
const playing = ref(false)
const meta = ref({
  title: '',
  sourceChannel: 'INTERNAL_CREATED',
  usageType: 'INTERNAL_TEST',
  rightsHolderType: 'COMPANY',
  authorizationStatus: 'PRIVATE_ONLY',
  rightsHolderName: '哞屋',
  rightsHolderContact: '',
  ownerPhone: '',
  tags: '',
  internalNotes: ''
})
const urls = new ObjectUrlRegistry()
let playTimer = 0
let saveTimer = 0
let saveChain: Promise<unknown> = Promise.resolve()
let draggedPosition = -1

const draftId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))
const isOwner = computed(() => session.staffRole === 'OWNER')
const currentPreview = computed(() => {
  const index = selectedOrder.value[previewPosition.value]
  return index === undefined ? '' : candidateUrls.value[index] || ''
})
const canAbandon = computed(
  () =>
    draft.value?.status === 'DRAFT' &&
    (isOwner.value || draft.value?.createdByStaffId === session.user?.id)
)
const step = computed(() =>
  screen.value === 'meta' ? 3 : ['trim', 'processing', 'editor'].includes(screen.value) ? 2 : 1
)
const selectedSet = computed(() => new Set(selectedOrder.value))

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : '网络错误'
}
function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
function flash(text: string): void {
  notice.value = text
  window.setTimeout(() => {
    if (notice.value === text) notice.value = ''
  }, 2800)
}
function stopPlay(): void {
  window.clearTimeout(playTimer)
  playing.value = false
}
function tick(): void {
  if (!playing.value || !selectedOrder.value.length) return
  previewPosition.value = (previewPosition.value + 1) % selectedOrder.value.length
  playTimer = window.setTimeout(tick, playbackMs.value)
}
function togglePlay(): void {
  if (playing.value) return stopPlay()
  if (!selectedOrder.value.length) return
  playing.value = true
  playTimer = window.setTimeout(tick, playbackMs.value)
}
function showSelected(position: number): void {
  stopPlay()
  if (!selectedOrder.value.length) return
  previewPosition.value = (position + selectedOrder.value.length) % selectedOrder.value.length
}
function rememberSelection(): void {
  selectionHistory.value.push([...selectedOrder.value])
  if (selectionHistory.value.length > 30) selectionHistory.value.shift()
}
function undoSelection(): void {
  const previous = selectionHistory.value.pop()
  if (!previous) return
  selectedOrder.value = previous
  previewPosition.value = Math.min(previewPosition.value, Math.max(0, previous.length - 1))
  scheduleSave()
}
function sourceFingerprint(): string {
  return JSON.stringify(
    files.value.map((file) => [file.name, file.size, file.type, file.lastModified])
  )
}
function requestKey(): string {
  const fingerprint = sourceFingerprint()
  if (sessionStorage.getItem('mowo_frame_draft_source') !== fingerprint) {
    sessionStorage.setItem('mowo_frame_draft_source', fingerprint)
    sessionStorage.setItem('mowo_frame_draft_request', crypto.randomUUID())
  }
  return sessionStorage.getItem('mowo_frame_draft_request') || crypto.randomUUID()
}

async function loadDrafts(status = draftStatus.value): Promise<void> {
  draftStatus.value = status
  loading.value = true
  error.value = ''
  try {
    drafts.value = await listFrameDrafts(status)
  } catch (cause) {
    error.value = message(cause)
  } finally {
    loading.value = false
  }
}
function resetEditor(): void {
  stopPlay()
  window.clearTimeout(saveTimer)
  urls.releaseAll()
  candidates.value = []
  candidateUrls.value = []
  selectedOrder.value = []
  selectionHistory.value = []
  previewPosition.value = 0
  videoUrl.value = ''
}
async function showHome(): Promise<void> {
  resetEditor()
  draft.value = null
  saveState.value = ''
  screen.value = 'home'
  if (draftId.value) {
    await router.replace({ name: 'admin-frame-making' })
    return
  }
  await loadDrafts()
}
function openImport(): void {
  resetEditor()
  files.value = []
  uploadedSourceKeys.value = []
  ratio.value = '1:1'
  title.value = ''
  uploadDone.value = 0
  screen.value = 'import'
}
function chooseFiles(input: FileList | File[]): void {
  try {
    const validated = validateSourceFiles(input)
    files.value = [...validated.files].sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
    )
    sourceType.value =
      validated.kind === 'video' ? 'VIDEO' : validated.kind === 'gif' ? 'GIF' : 'IMAGES'
    uploadedSourceKeys.value = []
    error.value = ''
  } catch (cause) {
    flash(message(cause))
  }
}
function clearFiles(): void {
  files.value = []
  uploadedSourceKeys.value = []
  uploadDone.value = 0
}
function dropped(event: DragEvent): void {
  if (event.dataTransfer?.files) chooseFiles(event.dataTransfer.files)
}
async function inspectFirstFile(): Promise<Record<string, unknown>> {
  const file = files.value[0]
  if (!file) return {}
  if (sourceType.value === 'VIDEO') {
    const localUrl = URL.createObjectURL(file)
    const probe = document.createElement('video')
    try {
      await new Promise<void>((resolve, reject) => {
        probe.onloadedmetadata = () => resolve()
        probe.onerror = () => reject(new Error('视频无法读取'))
        probe.src = localUrl
      })
      return { width: probe.videoWidth, height: probe.videoHeight, duration: probe.duration }
    } finally {
      URL.revokeObjectURL(localUrl)
    }
  }
  const bitmap = await createImageBitmap(file)
  const result = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return result
}
async function createDraftAndContinue(): Promise<void> {
  if (!files.value.length || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const dimensions = await inspectFirstFile()
    if (!uploadedSourceKeys.value.length) {
      for (const file of files.value) {
        uploadedSourceKeys.value.push(await uploadFrameMakingFile(file, 'LIBRARY_SOURCE'))
        uploadDone.value = uploadedSourceKeys.value.length
      }
    }
    const created = await createFrameDraft({
      clientRequestId: requestKey(),
      sourceKeys: uploadedSourceKeys.value,
      sourceType: sourceType.value,
      targetRatio: ratio.value,
      title: title.value.trim() || '未命名动画',
      sourceMetadata: {
        ...dimensions,
        count: files.value.length,
        totalBytes: files.value.reduce((sum, file) => sum + file.size, 0)
      }
    })
    sessionStorage.removeItem('mowo_frame_draft_source')
    sessionStorage.removeItem('mowo_frame_draft_request')
    await router.push({ name: 'admin-frame-making-editor', params: { id: created.id } })
  } catch (cause) {
    error.value = message(cause)
  } finally {
    busy.value = false
  }
}

function trustedSourceUrl(value: string): string {
  const parsed = new URL(value, window.location.origin)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('素材下载地址不受信任')
  return parsed.href
}
async function downloadSources(detail: FrameDraftDetail): Promise<File[]> {
  return Promise.all(
    detail.sources.map(async (source) => {
      const response = await fetch(trustedSourceUrl(source.url), { credentials: 'omit' })
      if (!response.ok) throw new Error(`原素材下载失败：${source.name}`)
      const blob = await response.blob()
      return new File([blob], source.name, { type: source.type || blob.type })
    })
  )
}
async function openDraft(id: string): Promise<void> {
  resetEditor()
  loading.value = true
  error.value = ''
  try {
    const detail = await getFrameDraft(id)
    if (detail.status === 'PUBLISHED' && detail.animationAsset) {
      await router.replace({
        name: 'admin-frame-library',
        query: { keyword: detail.animationAsset.assetNo }
      })
      return
    }
    if (!['DRAFT', 'READY_FOR_REVIEW'].includes(detail.status))
      throw new Error('该草稿已经放弃，不能继续编辑')
    if (detail.status === 'READY_FOR_REVIEW' && !isOwner.value)
      throw new Error('该草稿已提交负责人确认，生产人员不能继续修改')
    draft.value = detail
    files.value = await downloadSources(detail)
    sourceType.value = detail.sourceType
    ratio.value = detail.targetRatio
    title.value = detail.title
    meta.value = {
      title: detail.title,
      sourceChannel: detail.sourceChannel,
      usageType: detail.usageType,
      rightsHolderType: detail.rightsHolderType,
      authorizationStatus: detail.authorizationStatus,
      rightsHolderName: detail.rightsHolderName || '',
      rightsHolderContact: detail.rightsHolderContact || '',
      ownerPhone: '',
      tags: Array.isArray(detail.tags) ? detail.tags.join('，') : '',
      internalNotes: detail.internalNotes || ''
    }
    playbackMs.value = Number(detail.editorData?.playbackMs) || 220
    await prepareSource()
  } catch (cause) {
    error.value = message(cause)
    screen.value = 'home'
  } finally {
    loading.value = false
  }
}
async function prepareSource(): Promise<void> {
  if (sourceType.value !== 'VIDEO') return processNonVideo()
  videoUrl.value = urls.create(files.value[0]!)
  const probe = document.createElement('video')
  probe.preload = 'metadata'
  probe.src = videoUrl.value
  await new Promise<void>((resolve, reject) => {
    probe.onloadedmetadata = () => resolve()
    probe.onerror = () => reject(new Error('视频无法读取，请转换格式后重试'))
  })
  videoDuration.value = probe.duration
  trimStart.value = Math.max(
    0,
    Math.min(Number(draft.value?.editorData?.trimStart) || 0, probe.duration - 0.5)
  )
  trimEnd.value = Math.min(
    probe.duration,
    Math.max(
      Number(draft.value?.editorData?.trimEnd) || Math.min(probe.duration, 8),
      trimStart.value + 0.5
    )
  )
  screen.value = 'trim'
}
async function processNonVideo(): Promise<void> {
  screen.value = 'processing'
  processingDone.value = 0
  processingTotal.value = files.value.length
  try {
    const options = {
      onProgress: ({ completed, total }: { completed: number; total: number }) => {
        processingDone.value = completed
        processingTotal.value = total
      }
    }
    enterEditor(
      sourceType.value === 'GIF'
        ? await processGif(files.value[0]!, options)
        : await processImageSequence(files.value, options)
    )
  } catch (cause) {
    error.value = message(cause)
    screen.value = 'home'
  }
}
async function extractVideo(): Promise<void> {
  if (!video.value || busy.value) return
  busy.value = true
  screen.value = 'processing'
  try {
    enterEditor(
      await extractVideoFrames(video.value, trimStart.value, trimEnd.value, {
        onProgress: ({ completed, total }) => {
          processingDone.value = completed
          processingTotal.value = total
        }
      })
    )
  } catch (cause) {
    error.value = message(cause)
    screen.value = 'trim'
  } finally {
    busy.value = false
  }
}
function enterEditor(frames: ProcessedFrame[]): void {
  candidates.value = frames
  candidateUrls.value = frames.map((frame) => urls.create(frame.blob))
  const saved = draft.value?.editorData?.selectedIndexes
  const legacySaved = draft.value?.editorData?.selectedIds
  selectedOrder.value = Array.isArray(saved)
    ? saved
        .map(Number)
        .filter((index) => Number.isInteger(index) && index >= 0 && index < frames.length)
    : Array.isArray(legacySaved)
      ? legacySaved
          .map((id) => {
            const sourceIndex = Number(String(id).split('-').at(-1))
            return frames.findIndex((frame) => frame.sourceIndex === sourceIndex)
          })
          .filter((index) => index >= 0)
      : frames.map((frame, index) => (frame.selected ? index : -1)).filter((index) => index >= 0)
  if (!selectedOrder.value.length) selectedOrder.value = frames.map((_, index) => index)
  previewPosition.value = 0
  selectionHistory.value = []
  screen.value = 'editor'
}
function toggleCandidate(index: number): void {
  rememberSelection()
  if (selectedSet.value.has(index))
    selectedOrder.value = selectedOrder.value.filter((value) => value !== index)
  else selectedOrder.value.push(index)
  previewPosition.value = Math.min(
    previewPosition.value,
    Math.max(0, selectedOrder.value.length - 1)
  )
  scheduleSave()
}
function selectAll(value: boolean): void {
  rememberSelection()
  selectedOrder.value = value ? candidates.value.map((_, index) => index) : []
  previewPosition.value = 0
  scheduleSave()
}
async function autoDeduplicate(): Promise<void> {
  if (candidates.value.length < 2 || busy.value) return
  busy.value = true
  try {
    const hashes: Uint8Array[] = []
    for (const frame of candidates.value) {
      const bitmap = await createImageBitmap(frame.blob)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 8
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('当前浏览器无法执行智能去重')
        context.drawImage(bitmap, 0, 0, 8, 8)
        hashes.push(averageHash(context.getImageData(0, 0, 8, 8).data))
      } finally {
        bitmap.close()
      }
    }
    rememberSelection()
    selectedOrder.value = hashes
      .map((hash, index) =>
        index === 0 || hammingDistance(hash, hashes[index - 1]!) > 5 ? index : -1
      )
      .filter((index) => index >= 0)
    previewPosition.value = 0
    scheduleSave()
    flash(`已保留 ${selectedOrder.value.length} 帧；疑似重复帧仍可在左侧手动选回`)
  } catch (cause) {
    flash(message(cause))
  } finally {
    busy.value = false
  }
}
function sampleEvery(interval: number): void {
  if (selectedOrder.value.length < 2) return
  rememberSelection()
  selectedOrder.value = selectedOrder.value.filter((_, index) => index % interval === 0)
  previewPosition.value = 0
  scheduleSave()
}
function cloneCurrent(): void {
  const current = selectedOrder.value[previewPosition.value]
  if (current === undefined) return
  rememberSelection()
  selectedOrder.value.splice(previewPosition.value + 1, 0, current)
  previewPosition.value += 1
  scheduleSave()
}
function removeSelected(position: number): void {
  rememberSelection()
  selectedOrder.value.splice(position, 1)
  previewPosition.value = Math.min(
    previewPosition.value,
    Math.max(0, selectedOrder.value.length - 1)
  )
  scheduleSave()
}
function droppedOrder(position: number): void {
  if (draggedPosition < 0 || draggedPosition === position) return
  rememberSelection()
  const [moved] = selectedOrder.value.splice(draggedPosition, 1)
  if (moved !== undefined) selectedOrder.value.splice(position, 0, moved)
  previewPosition.value = position
  draggedPosition = -1
  scheduleSave()
}
function editorData(): Record<string, unknown> {
  return {
    trimStart: trimStart.value,
    trimEnd: trimEnd.value,
    selectedIndexes: [...selectedOrder.value],
    playbackMs: playbackMs.value,
    candidateCount: candidates.value.length
  }
}
function saveDraft(payload: Record<string, unknown>): Promise<void> {
  if (!draft.value) return Promise.resolve()
  const active = draft.value
  const operation = saveChain
    .catch(() => undefined)
    .then(async () => {
      saveState.value = '正在保存…'
      const result = await updateFrameDraft(active.id, { ...payload, revision: active.revision })
      active.revision = result.revision
      saveState.value = `已自动保存 ${new Date(result.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
    })
  saveChain = operation.catch((cause) => {
    saveState.value = message(cause)
  })
  return operation
}
function scheduleSave(): void {
  if (!draft.value) return
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void saveDraft({ editorData: editorData() }).catch(() => undefined)
  }, 700)
}
function openMetadata(): void {
  if (!selectedOrder.value.length) return flash('至少选择一帧')
  if (selectedOrder.value.length > 50) return flash('正式动画最多保存 50 帧，请继续筛选')
  stopPlay()
  screen.value = 'meta'
}
function splitTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[，,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ].slice(0, 30)
}
async function saveMetadata(): Promise<void> {
  if (!draft.value) return
  if (!meta.value.title.trim()) throw new Error('请填写动画名称')
  await saveDraft({
    title: meta.value.title,
    sourceChannel: meta.value.sourceChannel,
    usageType: meta.value.usageType,
    rightsHolderType: meta.value.rightsHolderType,
    authorizationStatus: meta.value.authorizationStatus,
    rightsHolderName: meta.value.rightsHolderName,
    rightsHolderContact: meta.value.rightsHolderContact,
    ownerPhone: meta.value.ownerPhone,
    tags: splitTags(meta.value.tags),
    internalNotes: meta.value.internalNotes,
    editorData: editorData()
  })
  draft.value.title = meta.value.title
}
async function frameFile(index: number, order: number): Promise<File> {
  const frame = candidates.value[index]
  if (!frame) throw new Error('最终帧数据不完整')
  const bitmap = await createImageBitmap(frame.blob)
  try {
    const [rw, rh] = ratio.value.split(':').map(Number)
    const targetRatio = (rw || 1) / (rh || 1)
    let sx = 0,
      sy = 0,
      sw = bitmap.width,
      sh = bitmap.height
    if (bitmap.width / bitmap.height > targetRatio) {
      sw = bitmap.height * targetRatio
      sx = (bitmap.width - sw) / 2
    } else {
      sh = bitmap.width / targetRatio
      sy = (bitmap.height - sh) / 2
    }
    const longSide = Math.min(1200, Math.max(sw, sh))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(targetRatio >= 1 ? longSide : longSide * targetRatio))
    canvas.height = Math.max(1, Math.round(targetRatio >= 1 ? longSide / targetRatio : longSide))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法生成最终帧')
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('最终帧编码失败'))),
        'image/jpeg',
        0.92
      )
    )
    return new File([blob], `frame-${String(order + 1).padStart(3, '0')}.jpg`, {
      type: 'image/jpeg'
    })
  } finally {
    bitmap.close()
  }
}
async function finishDraft(): Promise<void> {
  if (!draft.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await saveMetadata()
    if (!isOwner.value) {
      const result = await submitFrameDraft(draft.value.id, draft.value.revision)
      draft.value.revision = result.revision
      draft.value.status = result.status
      flash('已提交负责人确认')
      await showHome()
      return
    }
    const uniqueIndexes = [...new Set(selectedOrder.value)]
    const keyByIndex = new Map<number, string>()
    for (let position = 0; position < uniqueIndexes.length; position += 1) {
      const index = uniqueIndexes[position]!
      keyByIndex.set(
        index,
        await uploadFrameMakingFile(await frameFile(index, position), 'LIBRARY_FRAME')
      )
      saveState.value = `正在上传最终帧 ${position + 1}/${uniqueIndexes.length}`
    }
    const result = await publishFrameDraft(
      draft.value.id,
      selectedOrder.value.map((index) => keyByIndex.get(index)!)
    )
    await router.replace({ name: 'admin-frame-library', query: { keyword: result.assetNo } })
  } catch (cause) {
    error.value = message(cause)
    flash(error.value)
  } finally {
    busy.value = false
  }
}
async function abandon(): Promise<void> {
  if (
    !draft.value ||
    !window.confirm(`确定放弃草稿 ${draft.value.draftNo} 吗？原素材和操作记录仍会保留。`)
  )
    return
  try {
    await abandonFrameDraft(draft.value.id)
    await showHome()
  } catch (cause) {
    flash(message(cause))
  }
}
async function openRow(row: FrameDraftListItem): Promise<void> {
  if (row.status === 'PUBLISHED' && row.animationAsset) {
    await router.push({
      name: 'admin-frame-library',
      query: { keyword: row.animationAsset.assetNo }
    })
    return
  }
  if (!['DRAFT', 'READY_FOR_REVIEW'].includes(row.status))
    return flash('该草稿已放弃，不能继续编辑')
  await router.push({ name: 'admin-frame-making-editor', params: { id: row.id } })
}

watch(playbackMs, () => {
  if (playing.value) {
    stopPlay()
    togglePlay()
  }
  scheduleSave()
})
watch(draftId, async (id) => {
  if (id) await openDraft(id)
  else if (screen.value !== 'import') await showHome()
})
onMounted(async () => {
  await nextTick()
  if (draftId.value) await openDraft(draftId.value)
  else await loadDrafts()
})
onBeforeUnmount(() => {
  stopPlay()
  window.clearTimeout(saveTimer)
  urls.releaseAll()
})
</script>

<template>
  <div class="making-page">
    <AdminSidebar v-model:collapsed="collapsed" v-model:mobile-open="mobileOpen" />
    <main class="making-main" :class="{ expanded: collapsed }">
      <header class="making-topbar">
        <div class="top-title">
          <button class="mk-btn menu-btn" @click="mobileOpen = true">☰</button>
          <div>
            <h1>帧图制作</h1>
            <div class="draft-no">{{ draft?.draftNo || '新制作' }}</div>
          </div>
        </div>
        <div class="top-actions">
          <span class="save-state">{{ saveState }}</span
          ><button v-if="canAbandon" class="mk-btn btn-danger" @click="abandon">放弃草稿</button
          ><button v-if="screen !== 'home'" class="mk-btn" @click="showHome">返回草稿</button>
        </div>
      </header>
      <nav class="steps">
        <template v-for="(label, index) in ['导入素材', '筛选编辑', '确认入库']" :key="label"
          ><div v-if="index" class="step-line"></div>
          <div class="step" :class="{ active: step === index + 1, done: step > index + 1 }">
            <i>{{ index + 1 }}</i
            ><span>{{ label }}</span>
          </div></template
        >
      </nav>
      <div class="making-workspace">
        <p v-if="error" class="error-box">{{ error }}</p>
        <section v-if="screen === 'home'" class="view active">
          <div class="page-head">
            <div>
              <h2>制作草稿</h2>
              <p>继续未完成的工作，或从新素材开始制作。</p>
            </div>
          </div>
          <div class="home-grid">
            <article class="mk-panel new-panel">
              <div>
                <div class="new-icon">＋</div>
                <h3>新建帧图制作</h3>
                <p>导入视频、GIF 或图片组，使用完整帧编辑器筛选后生成正式动画资产。</p>
              </div>
              <button class="mk-btn btn-black" @click="openImport">开始制作</button>
            </article>
            <article class="mk-panel draft-panel">
              <div class="draft-tabs">
                <button
                  v-for="item in [
                    ['DRAFT', '制作中'],
                    ['READY_FOR_REVIEW', '待负责人确认'],
                    ['PUBLISHED', '已入库'],
                    ['ABANDONED', '已放弃']
                  ] as const"
                  :key="item[0]"
                  class="mk-btn"
                  :class="{ 'btn-black': draftStatus === item[0] }"
                  @click="loadDrafts(item[0])"
                >
                  {{ item[1] }}
                </button>
              </div>
              <div class="draft-list">
                <div v-if="loading" class="empty">正在读取草稿...</div>
                <button
                  v-for="row in drafts"
                  v-else
                  :key="row.id"
                  class="draft-row"
                  @click="openRow(row)"
                >
                  <div>
                    <strong>{{ row.title }}</strong
                    ><span class="sub"
                      >{{ row.draftNo }} ·
                      {{
                        row.sourceType === 'IMAGES' ? `${row.sourceCount} 张图片` : row.sourceType
                      }}</span
                    >
                  </div>
                  <span class="badge">{{ row.targetRatio }}</span
                  ><span class="sub">{{ row.editorName }}<br />{{ formatTime(row.updatedAt) }}</span
                  ><span class="mk-btn">{{
                    row.status === 'DRAFT'
                      ? '继续'
                      : row.status === 'READY_FOR_REVIEW'
                        ? '负责人确认'
                        : row.status === 'PUBLISHED'
                          ? '查看资产'
                          : '查看'
                  }}</span>
                </button>
                <div v-if="!loading && !drafts.length" class="empty">这里暂时没有记录</div>
              </div>
            </article>
          </div>
        </section>

        <section v-else-if="screen === 'import'" class="view active">
          <div class="page-head">
            <div>
              <h2>导入原素材</h2>
              <p>一个视频或 GIF，或者按文件名排序的一组图片。</p>
            </div>
          </div>
          <article class="mk-panel import-panel">
            <label v-if="!files.length" class="drop" @dragover.prevent @drop.prevent="dropped"
              ><input
                hidden
                type="file"
                multiple
                accept="video/mp4,video/webm,video/quicktime,image/gif,image/jpeg,image/png,image/webp"
                @change="chooseFiles(($event.target as HTMLInputElement).files || [])"
              /><span class="drop-icon">⇧</span>
              <h3>选择或拖入原素材</h3>
              <p>单个 MP4、WebM、MOV、GIF，或最多 50 张图片；合计不超过 200MB</p></label
            >
            <div v-else class="file-summary">
              <div>
                <strong>{{
                  sourceType === 'IMAGES' ? `${files.length} 张图片` : files[0]?.name
                }}</strong>
                <div class="sub">
                  {{ sourceType }} ·
                  {{ formatSize(files.reduce((sum, file) => sum + file.size, 0)) }}
                </div>
              </div>
              <button class="mk-btn" @click="clearFiles">重新选择</button>
            </div>
            <div class="form-row">
              <div class="field">
                <label>画面比例</label
                ><select v-model="ratio">
                  <option>1:1</option>
                  <option>4:3</option>
                  <option>3:4</option>
                  <option>16:9</option>
                  <option>9:16</option>
                </select>
              </div>
              <div class="field">
                <label for="frameDraftTitle">草稿名称</label
                ><input
                  id="frameDraftTitle"
                  v-model="title"
                  maxlength="200"
                  placeholder="可稍后修改"
                />
              </div>
            </div>
            <div v-if="busy" class="progress">
              <div class="progress-track">
                <div
                  class="progress-fill"
                  :style="{ width: `${files.length ? (uploadDone / files.length) * 100 : 0}%` }"
                ></div>
              </div>
              <div class="progress-text">正在上传 {{ uploadDone }}/{{ files.length }}</div>
            </div>
            <div class="actions">
              <button class="mk-btn" @click="showHome">取消</button
              ><button
                class="mk-btn btn-black"
                :disabled="!files.length || busy"
                @click="createDraftAndContinue"
              >
                {{ busy ? '正在处理…' : '上传并开始筛选' }}
              </button>
            </div>
          </article>
        </section>

        <section v-else-if="screen === 'trim'" class="view active">
          <div class="page-head">
            <div>
              <h2>选择视频片段</h2>
              <p>单次提取最长 8 秒，随后仍可逐帧选择。</p>
            </div>
          </div>
          <div class="trim-layout">
            <article class="mk-panel video-panel">
              <div class="video-wrap">
                <video ref="video" :src="videoUrl" controls playsinline></video>
              </div>
            </article>
            <aside class="mk-panel trim-side">
              <h3>裁剪范围</h3>
              <p>调整起点和终点。为了浏览器稳定，最多提取 150 个候选帧。</p>
              <div class="range-field">
                <label
                  ><span>开始</span><strong>{{ trimStart.toFixed(1) }} 秒</strong></label
                ><input
                  v-model.number="trimStart"
                  type="range"
                  min="0"
                  :max="Math.max(0, trimEnd - 0.5)"
                  step=".1"
                />
              </div>
              <div class="range-field">
                <label
                  ><span>结束</span><strong>{{ trimEnd.toFixed(1) }} 秒</strong></label
                ><input
                  v-model.number="trimEnd"
                  type="range"
                  :min="trimStart + 0.5"
                  :max="Math.min(videoDuration, trimStart + 8)"
                  step=".1"
                />
              </div>
              <div class="trim-summary">
                已选择 {{ (trimEnd - trimStart).toFixed(1) }} 秒，预计提取
                {{ Math.min(150, Math.max(1, Math.ceil((trimEnd - trimStart) * 30))) }} 个候选帧。
              </div>
              <div class="actions">
                <button class="mk-btn" @click="showHome">稍后继续</button
                ><button class="mk-btn btn-black" @click="extractVideo">提取候选帧</button>
              </div>
            </aside>
          </div>
        </section>

        <section v-else-if="screen === 'processing'" class="view active">
          <article class="mk-panel processing-panel">
            <div class="drop-icon">◌</div>
            <h2>正在处理素材</h2>
            <p>{{ processingDone }}/{{ processingTotal || '—' }}</p>
            <div class="progress-track">
              <div
                class="progress-fill"
                :style="{
                  width: `${processingTotal ? (processingDone / processingTotal) * 100 : 0}%`
                }"
              ></div>
            </div>
          </article>
        </section>

        <section v-else-if="screen === 'editor'" class="view active">
          <div class="page-head">
            <div>
              <h2>筛选核心帧</h2>
              <p>左侧选择候选帧，右侧调整最终播放顺序。</p>
            </div>
            <button class="mk-btn" @click="prepareSource">重新提取</button>
          </div>
          <div class="editor-layout">
            <article class="mk-panel candidate-panel">
              <div class="tool-row">
                <div class="tool-group">
                  <button class="mk-btn" @click="selectAll(true)">全选</button
                  ><button class="mk-btn" @click="selectAll(false)">清空</button
                  ><button class="mk-btn" :disabled="busy" @click="autoDeduplicate">
                    相似帧去重</button
                  ><button class="mk-btn" @click="sampleEvery(2)">每 2 帧抽取</button
                  ><button
                    class="mk-btn"
                    :disabled="!selectionHistory.length"
                    @click="undoSelection"
                  >
                    撤销
                  </button>
                </div>
                <div class="count">{{ candidates.length }} 个候选帧</div>
              </div>
              <div class="candidate-grid">
                <button
                  v-for="(url, index) in candidateUrls"
                  :key="url"
                  class="candidate"
                  :class="{ selected: selectedSet.has(index) }"
                  @click="toggleCandidate(index)"
                >
                  <img :src="url" alt="" /><span class="check">{{
                    selectedSet.has(index) ? '✓' : ''
                  }}</span
                  ><span class="idx">{{ index + 1 }}</span>
                </button>
              </div>
            </article>
            <aside class="mk-panel selection-panel">
              <div class="preview">
                <img v-if="currentPreview" :src="currentPreview" alt="当前帧" /><span
                  v-else
                  class="preview-empty"
                  >选择帧后可播放预览</span
                >
              </div>
              <div class="playbar">
                <button class="mk-btn icon-btn" title="第一帧" @click="showSelected(0)">⏮</button
                ><button
                  class="mk-btn icon-btn"
                  title="上一帧"
                  @click="showSelected(previewPosition - 1)"
                >
                  ◀</button
                ><button class="mk-btn icon-btn" @click="togglePlay">
                  {{ playing ? 'Ⅱ' : '▶' }}</button
                ><button
                  class="mk-btn icon-btn"
                  title="下一帧"
                  @click="showSelected(previewPosition + 1)"
                >
                  ▶▌</button
                ><button
                  class="mk-btn icon-btn"
                  title="最后帧"
                  @click="showSelected(selectedOrder.length - 1)"
                >
                  ⏭</button
                ><span class="sub">速度</span
                ><input
                  v-model.number="playbackMs"
                  type="range"
                  min="80"
                  max="800"
                  step="20"
                /><span class="sub">{{ playbackMs }}ms</span>
              </div>
              <div class="selected-head">
                <strong>最终帧序列</strong><span class="count">{{ selectedOrder.length }} 帧</span>
              </div>
              <div class="selected-strip">
                <div
                  v-for="(index, position) in selectedOrder"
                  :key="`${index}-${position}`"
                  class="selected-frame"
                  :class="{ active: position === previewPosition }"
                  draggable="true"
                  @click="previewPosition = position"
                  @dragstart="draggedPosition = position"
                  @dragover.prevent
                  @drop="droppedOrder(position)"
                >
                  <img :src="candidateUrls[index]" alt="" /><span class="order">{{
                    position + 1
                  }}</span
                  ><button class="remove" @click.stop="removeSelected(position)">×</button>
                </div>
              </div>
              <div class="selection-actions">
                <button class="mk-btn" @click="cloneCurrent">复制当前帧</button
                ><button class="mk-btn btn-yellow" @click="openMetadata">填写入库资料</button>
              </div>
            </aside>
          </div>
        </section>

        <section v-else class="view active">
          <div class="page-head">
            <div>
              <h2>确认入库资料</h2>
              <p>来源不等于授权；销售用途必须明确确认授权。</p>
            </div>
          </div>
          <div class="meta-layout">
            <article class="mk-panel meta-panel">
              <div class="form-grid">
                <div class="field wide">
                  <label>动画名称 *</label><input v-model="meta.title" maxlength="200" />
                </div>
                <div class="field">
                  <label>素材来源 *</label
                  ><select v-model="meta.sourceChannel">
                    <option value="INTERNAL_CREATED">内部制作</option>
                    <option value="OFFLINE_CUSTOM">线下定制</option>
                    <option value="CREATOR_SUBMISSION">创作者提供</option>
                  </select>
                </div>
                <div class="field">
                  <label>当前用途 *</label
                  ><select v-model="meta.usageType">
                    <option value="INTERNAL_TEST">内部测试</option>
                    <option value="COMPANY_PRODUCT">公司自营商品</option>
                    <option value="PRIVATE_CUSTOM">私人定制</option>
                    <option value="COLLAB_SALE">联名销售</option>
                    <option value="UNDECIDED">暂未确定</option>
                  </select>
                </div>
                <div class="field">
                  <label>权利主体 *</label
                  ><select v-model="meta.rightsHolderType">
                    <option value="COMPANY">哞屋公司</option>
                    <option value="OFFLINE_CUSTOMER">线下客户</option>
                    <option value="CREATOR">创作者</option>
                    <option value="USER">网站用户</option>
                    <option value="UNCONFIRMED">暂未确认</option>
                  </select>
                </div>
                <div class="field">
                  <label>授权状态 *</label
                  ><select v-model="meta.authorizationStatus">
                    <option value="PRIVATE_ONLY">仅限私人或内部使用</option>
                    <option value="PENDING">授权确认中</option>
                    <option value="AUTHORIZED">已明确授权</option>
                  </select>
                </div>
                <div class="field">
                  <label>客户或权利人名称</label
                  ><input v-model="meta.rightsHolderName" maxlength="120" />
                </div>
                <div class="field">
                  <label>联系方式</label
                  ><input v-model="meta.rightsHolderContact" maxlength="200" />
                </div>
                <div class="field">
                  <label>绑定网站账号手机号</label
                  ><input v-model="meta.ownerPhone" maxlength="20" placeholder="没有账号可以留空" />
                </div>
                <div class="field">
                  <label>标签</label
                  ><input v-model="meta.tags" maxlength="300" placeholder="用逗号分隔" />
                </div>
                <div class="field wide">
                  <label>内部备注</label
                  ><textarea v-model="meta.internalNotes" maxlength="4000"></textarea>
                </div>
              </div>
              <div class="actions">
                <button class="mk-btn" @click="screen = 'editor'">返回筛选</button
                ><button
                  class="mk-btn"
                  :disabled="busy"
                  @click="
                    saveMetadata()
                      .then(() => flash('草稿资料已保存'))
                      .catch((cause) => flash(message(cause)))
                  "
                >
                  保存草稿</button
                ><button class="mk-btn btn-black" :disabled="busy" @click="finishDraft">
                  {{ isOwner ? '确认并加入资产库' : '提交负责人确认' }}
                </button>
              </div>
            </article>
            <aside class="mk-panel summary-panel">
              <strong>最终动画预览</strong>
              <div class="summary-preview">
                <img v-if="currentPreview" :src="currentPreview" alt="最终动画首帧" />
              </div>
              <div class="summary-list">
                <div class="summary-item">
                  <span>草稿</span><strong>{{ draft?.draftNo }}</strong>
                </div>
                <div class="summary-item">
                  <span>画面比例</span><strong>{{ ratio }}</strong>
                </div>
                <div class="summary-item">
                  <span>最终帧数</span><strong>{{ selectedOrder.length }} 帧</strong>
                </div>
                <div class="summary-item">
                  <span>原素材</span
                  ><strong>{{
                    sourceType === 'IMAGES' ? `${files.length} 张图片` : sourceType
                  }}</strong>
                </div>
              </div>
              <div class="notice">
                {{
                  isOwner
                    ? '确认后生成正式 ANM 和 V1。草稿与原素材继续保留，正式版本不可覆盖。'
                    : '完成筛选和资料后提交负责人确认，只有负责人可以正式入库。'
                }}
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
    <div class="toast" :class="{ show: notice }">{{ notice }}</div>
  </div>
</template>
