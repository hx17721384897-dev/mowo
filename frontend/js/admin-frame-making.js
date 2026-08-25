const API_BASE = location.hostname === '127.0.0.1' ? 'http://127.0.0.1:3001' : 'http://localhost:3001'
const token = localStorage.getItem('mowo_token') || ''
const MAX_BYTES = 200 * 1024 * 1024
const MAX_FRAMES = 150
const MAX_TRIM_SECONDS = 8

let currentUser = null
let currentDraft = null
let sourceFiles = []
let localSourceFiles = []
let sourceKind = null
let candidates = []
let selectedIds = []
let previewIndex = 0
let playTimer = null
let dragOrder = null
let autosaveTimer = null
let saveChain = Promise.resolve()
const defaultDropContent = document.getElementById('dropZone').innerHTML

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

function toast(message) {
  const element = document.getElementById('toast')
  element.textContent = message
  element.classList.add('show')
  clearTimeout(element._timer)
  element._timer = setTimeout(() => element.classList.remove('show'), 2600)
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || `请求失败（${response.status}）`)
    error.code = payload.code
    throw error
  }
  return payload.data
}

function showView(id, step = 1) {
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === id))
  document.querySelectorAll('.step').forEach(item => {
    const value = Number(item.dataset.step)
    item.classList.toggle('active', value === step)
    item.classList.toggle('done', value < step)
  })
  document.getElementById('homeBtn').hidden = id === 'homeView'
  window.scrollTo({ top: 0 })
}

function setDraftHeader() {
  document.getElementById('draftNo').textContent = currentDraft ? currentDraft.draftNo : '新制作'
  const canAbandon = currentDraft?.status === 'DRAFT' && (
    currentUser?.staffRole === 'OWNER' || currentDraft.createdByStaffId === currentUser?.id
  )
  document.getElementById('abandonBtn').hidden = !canAbandon
}

function setSaveState(text, isError = false) {
  const element = document.getElementById('saveState')
  element.textContent = text
  element.style.color = isError ? 'var(--red)' : 'var(--green)'
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(value) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

async function init() {
  if (!token) return location.replace('index.html')
  try {
    currentUser = await api('/api/v1/account/me')
    if (!['OWNER', 'PRODUCTION'].includes(currentUser.staffRole)) return location.replace('index.html')
    await loadDrafts('DRAFT')
    const draftId = new URLSearchParams(location.search).get('draftId')
    if (draftId) await openDraft(draftId)
  } catch (error) {
    toast(error.message)
    if (/登录|权限|401|403/.test(error.message)) setTimeout(() => location.replace('index.html'), 800)
  }
}

async function loadDrafts(status = 'DRAFT', button = null) {
  if (button) {
    button.parentElement.querySelectorAll('.btn').forEach(item => item.classList.remove('btn-black'))
    button.classList.add('btn-black')
  }
  const list = document.getElementById('draftList')
  list.innerHTML = '<div class="empty">正在读取草稿...</div>'
  try {
    const rows = await api(`/api/admin/frame-making/drafts?status=${encodeURIComponent(status)}`)
    list.innerHTML = rows.length ? rows.map(row => `<article class="draft-row" onclick="openDraft('${row.id}')">
      <div><strong>${esc(row.title)}</strong><span class="sub">${esc(row.draftNo)} · ${row.sourceType === 'IMAGES' ? `${row.sourceCount} 张图片` : row.sourceType}</span></div>
      <span class="badge">${esc(row.targetRatio)}</span><span class="sub">${esc(row.editorName)}<br>${formatTime(row.updatedAt)}</span>
      <button class="btn">${row.status === 'DRAFT' ? '继续' : row.status === 'PUBLISHED' ? '查看资产' : '查看'}</button>
    </article>`).join('') : '<div class="empty">这里暂时没有记录</div>'
  } catch (error) {
    list.innerHTML = `<div class="empty">${esc(error.message)}</div>`
  }
}

function showHome() {
  stopPlay()
  currentDraft = null
  candidates = []
  selectedIds = []
  localSourceFiles = []
  setDraftHeader()
  setSaveState('')
  history.replaceState({}, '', 'admin-frame-making.html')
  showView('homeView', 1)
  loadDrafts('DRAFT')
}

async function abandonDraft() {
  if (!currentDraft || !confirm(`确定放弃草稿 ${currentDraft.draftNo} 吗？原素材和操作记录仍会保留。`)) return
  try {
    await api(`/api/admin/frame-making/drafts/${currentDraft.id}/abandon`, { method: 'POST', body: '{}' })
    toast('草稿已放弃')
    setTimeout(showHome, 500)
  } catch (error) {
    toast(error.message)
  }
}

function openImport() {
  currentDraft = null
  sourceFiles = []
  localSourceFiles = []
  clearFiles()
  document.getElementById('importRatio').value = '1:1'
  document.getElementById('importTitle').value = ''
  setDraftHeader()
  showView('importView', 1)
}

function validateFiles(files) {
  if (!files.length) return '请选择素材'
  if (files.length > 50) return '图片组最多 50 张'
  const total = files.reduce((sum, file) => sum + file.size, 0)
  if (total > MAX_BYTES) return '本次素材合计不能超过 200MB'
  const ext = file => file.name.split('.').pop().toLowerCase()
  const imageExts = new Set(['jpg', 'jpeg', 'png', 'webp'])
  const videoExts = new Set(['mp4', 'webm', 'mov'])
  if (files.every(file => imageExts.has(ext(file)))) return { kind: 'IMAGES', total }
  if (files.length === 1 && ext(files[0]) === 'gif') return { kind: 'GIF', total }
  if (files.length === 1 && videoExts.has(ext(files[0]))) return { kind: 'VIDEO', total }
  return '请上传一个视频/GIF，或者同一组 JPG、PNG、WebP 图片'
}

function acceptFiles(files) {
  const result = validateFiles(files)
  if (typeof result === 'string') return toast(result)
  sourceKind = result.kind
  sourceFiles = [...files].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
  localSourceFiles = [...sourceFiles]
  document.getElementById('dropZone').style.display = 'none'
  document.getElementById('fileSummary').style.display = 'flex'
  document.getElementById('fileName').textContent = sourceKind === 'IMAGES' ? `${sourceFiles.length} 张图片` : sourceFiles[0].name
  document.getElementById('fileMeta').textContent = `${sourceKind} · ${formatSize(result.total)}`
  document.getElementById('startBtn').disabled = false
}

function clearFiles() {
  sourceFiles = []
  sourceKind = null
  const input = document.getElementById('sourceInput')
  input.value = ''
  const dropZone = document.getElementById('dropZone')
  dropZone.innerHTML = defaultDropContent
  dropZone.style.display = 'flex'
  document.getElementById('fileSummary').style.display = 'none'
  document.getElementById('startBtn').disabled = true
  document.getElementById('uploadProgress').style.display = 'none'
}

async function mediaDimensions(file) {
  if (sourceKind === 'VIDEO') {
    const url = URL.createObjectURL(file)
    return new Promise(resolve => {
      const video = document.createElement('video')
      video.onloadedmetadata = () => { resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration }); URL.revokeObjectURL(url) }
      video.onerror = () => { resolve({}); URL.revokeObjectURL(url) }
      video.src = url
    })
  }
  const url = URL.createObjectURL(file)
  return new Promise(resolve => {
    const image = new Image()
    image.onload = () => { resolve({ width: image.naturalWidth, height: image.naturalHeight }); URL.revokeObjectURL(url) }
    image.onerror = () => { resolve({}); URL.revokeObjectURL(url) }
    image.src = url
  })
}

async function createDraft() {
  if (!sourceFiles.length) return
  const button = document.getElementById('startBtn')
  button.disabled = true
  const progress = document.getElementById('uploadProgress')
  progress.style.display = 'block'
  try {
    const dimensions = await mediaDimensions(sourceFiles[0])
    const keys = await MowoPrivateUpload.uploadFiles({
      files: sourceFiles, token, purpose: 'LIBRARY_SOURCE',
      onProgress: (done, total) => {
        document.getElementById('uploadFill').style.width = `${Math.round(done / total * 100)}%`
        document.getElementById('uploadText').textContent = `正在上传 ${done}/${total}`
      }
    })
    const created = await api('/api/admin/frame-making/drafts', { method: 'POST', body: JSON.stringify({
      sourceKeys: keys, sourceType: sourceKind, targetRatio: document.getElementById('importRatio').value,
      title: document.getElementById('importTitle').value || '未命名动画',
      sourceMetadata: { ...dimensions, count: sourceFiles.length, totalBytes: sourceFiles.reduce((sum, file) => sum + file.size, 0) }
    }) })
    history.replaceState({}, '', `admin-frame-making.html?draftId=${encodeURIComponent(created.id)}`)
    await openDraft(created.id, true)
  } catch (error) {
    toast(error.message)
  } finally {
    button.disabled = false
  }
}

async function openDraft(id, keepLocal = false) {
  stopPlay()
  try {
    const draft = await api(`/api/admin/frame-making/drafts/${encodeURIComponent(id)}`)
    if (draft.status === 'PUBLISHED' && draft.animationAsset) {
      location.href = `admin-frame-library.html?keyword=${encodeURIComponent(draft.animationAsset.assetNo)}`
      return
    }
    if (draft.status !== 'DRAFT') return toast('该草稿已经放弃，不能继续编辑')
    currentDraft = draft
    if (!keepLocal) localSourceFiles = []
    setDraftHeader()
    setSaveState('已加载草稿')
    history.replaceState({}, '', `admin-frame-making.html?draftId=${encodeURIComponent(id)}`)
    if (draft.sourceType === 'VIDEO') return openVideoTrim()
    if (draft.sourceType === 'GIF') return decodeGif()
    return loadImageSources()
  } catch (error) {
    toast(error.message)
  }
}

function sourceUrl(index = 0) {
  if (localSourceFiles[index]) return URL.createObjectURL(localSourceFiles[index])
  return currentDraft.sources[index]?.url || ''
}

function openVideoTrim() {
  const video = document.getElementById('sourceVideo')
  video.src = sourceUrl(0)
  video.onloadedmetadata = () => {
    const saved = currentDraft.editorData || {}
    const start = Math.max(0, Math.min(Number(saved.trimStart || 0), video.duration - 0.5))
    const end = Math.min(video.duration, Math.max(Number(saved.trimEnd || Math.min(video.duration, MAX_TRIM_SECONDS)), start + 0.5))
    const startInput = document.getElementById('trimStart')
    const endInput = document.getElementById('trimEnd')
    startInput.max = Math.max(0, video.duration - 0.5)
    endInput.max = video.duration
    startInput.value = start
    endInput.value = end
    updateTrim()
  }
  showView('trimView', 2)
}

function updateTrim(changed = null) {
  const video = document.getElementById('sourceVideo')
  const startInput = document.getElementById('trimStart')
  const endInput = document.getElementById('trimEnd')
  let start = Number(startInput.value)
  let end = Number(endInput.value)
  if (changed === 'start') start = Math.min(start, end - 0.5)
  if (changed === 'end') end = Math.max(end, start + 0.5)
  if (end - start > MAX_TRIM_SECONDS) {
    if (changed === 'start') end = start + MAX_TRIM_SECONDS
    else start = end - MAX_TRIM_SECONDS
  }
  start = Math.max(0, start)
  end = Math.min(video.duration || end, end)
  startInput.value = start
  endInput.value = end
  document.getElementById('trimStartText').textContent = `${start.toFixed(1)} 秒`
  document.getElementById('trimEndText').textContent = `${end.toFixed(1)} 秒`
  document.getElementById('trimSummary').textContent = `已选择 ${(end - start).toFixed(1)} 秒，预计提取 ${Math.min(MAX_FRAMES, Math.max(1, Math.ceil((end - start) * 24)))} 个候选帧。`
  debounceSave()
}

function seekVideo(video, time) {
  return new Promise(resolve => {
    if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return resolve()
    const done = () => { clearTimeout(timer); video.removeEventListener('seeked', done); resolve() }
    const timer = setTimeout(done, 2500)
    video.addEventListener('seeked', done, { once: true })
    video.currentTime = time
  })
}

async function extractVideoFrames() {
  const video = document.getElementById('sourceVideo')
  const start = Number(document.getElementById('trimStart').value)
  const end = Number(document.getElementById('trimEnd').value)
  const duration = end - start
  if (duration < 0.5 || duration > MAX_TRIM_SECONDS + 0.01) return toast('请选择 0.5 至 8 秒的视频片段')
  const total = Math.min(MAX_FRAMES, Math.max(2, Math.ceil(duration * 24)))
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
  const context = canvas.getContext('2d')
  const progress = document.getElementById('extractProgress')
  progress.style.display = 'block'
  document.getElementById('extractBtn').disabled = true
  const frames = []
  try {
    for (let index = 0; index < total; index += 1) {
      const time = total === 1 ? start : start + duration * index / (total - 1)
      await seekVideo(video, Math.min(end - 0.001, time))
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push({ id: `video-${index}`, url: canvas.toDataURL('image/jpeg', 0.86), time })
      const percent = Math.round((index + 1) / total * 100)
      document.getElementById('extractFill').style.width = `${percent}%`
      document.getElementById('extractText').textContent = `正在提取 ${index + 1}/${total}`
      if (index % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0))
    }
    initCandidates(frames)
    await autoDeduplicate(true)
  } catch (error) {
    toast(`视频提取失败：${error.message}`)
  } finally {
    document.getElementById('extractBtn').disabled = false
  }
}

async function loadImageSources() {
  const urls = currentDraft.sources.map((source, index) => localSourceFiles[index] ? URL.createObjectURL(localSourceFiles[index]) : source.url)
  initCandidates(urls.map((url, index) => ({ id: `image-${index}`, url, sourceIndex: index })))
}

async function decodeGif() {
  showView('importView', 2)
  document.getElementById('dropZone').style.display = 'flex'
  document.getElementById('dropZone').innerHTML = '<div class="drop-icon">◌</div><h3>正在解析 GIF 帧</h3><p>完成后会自动进入筛选页面</p>'
  try {
    if (!('ImageDecoder' in window)) throw new Error('当前浏览器不支持 GIF 逐帧解析，请先转换成 MP4 或图片组')
    const buffer = localSourceFiles[0] ? await localSourceFiles[0].arrayBuffer() : await (await fetch(currentDraft.sources[0].url)).arrayBuffer()
    const decoder = new ImageDecoder({ data: buffer, type: 'image/gif' })
    await decoder.tracks.ready
    const count = decoder.tracks.selectedTrack.frameCount
    const step = Math.max(1, Math.ceil(count / MAX_FRAMES))
    const frames = []
    for (let index = 0; index < count; index += step) {
      const result = await decoder.decode({ frameIndex: index })
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 640 / Math.max(result.image.displayWidth, result.image.displayHeight))
      canvas.width = Math.round(result.image.displayWidth * scale)
      canvas.height = Math.round(result.image.displayHeight * scale)
      canvas.getContext('2d').drawImage(result.image, 0, 0, canvas.width, canvas.height)
      frames.push({ id: `gif-${index}`, url: canvas.toDataURL('image/png'), frameIndex: index })
      result.image.close()
    }
    decoder.close()
    initCandidates(frames)
  } catch (error) {
    toast(error.message)
    showHome()
  }
}

function initCandidates(items) {
  candidates = items
  const saved = Array.isArray(currentDraft.editorData?.selectedIds) ? currentDraft.editorData.selectedIds : []
  const valid = new Set(items.map(item => item.id))
  selectedIds = saved.filter(id => valid.has(id))
  if (!selectedIds.length) selectedIds = items.map(item => item.id)
  previewIndex = 0
  renderEditor()
  showView('editorView', 2)
  debounceSave()
}

function candidateById(id) {
  return candidates.find(item => item.id === id)
}

function toggleCandidate(id) {
  if (selectedIds.includes(id)) selectedIds = selectedIds.filter(item => item !== id)
  else selectedIds.push(id)
  previewIndex = Math.min(previewIndex, Math.max(0, selectedIds.length - 1))
  renderEditor()
  debounceSave()
}

function selectAll(value) {
  selectedIds = value ? candidates.map(item => item.id) : []
  previewIndex = 0
  renderEditor()
  debounceSave()
}

function renderEditor() {
  const selectedSet = new Set(selectedIds)
  document.getElementById('candidateGrid').innerHTML = candidates.map((frame, index) => `<button class="candidate ${selectedSet.has(frame.id) ? 'selected' : ''}" onclick="toggleCandidate('${frame.id}')"><img src="${esc(frame.url)}"><span class="check">${selectedSet.has(frame.id) ? '✓' : ''}</span><span class="idx">${index + 1}</span></button>`).join('')
  document.getElementById('candidateCount').textContent = `${candidates.length} 个候选帧`
  document.getElementById('selectedCount').textContent = `${selectedIds.length} 帧`
  document.getElementById('selectedStrip').innerHTML = selectedIds.map((id, index) => {
    const frame = candidateById(id)
    return `<div class="selected-frame ${index === previewIndex ? 'active' : ''}" draggable="true" data-order="${index}" onclick="showSelected(${index})"><img src="${esc(frame?.url || '')}"><span class="order">${index + 1}</span><button class="remove" onclick="event.stopPropagation();removeSelected(${index})" title="移除">×</button></div>`
  }).join('')
  bindSelectedDrag()
  renderPreview()
}

function renderPreview() {
  const preview = document.getElementById('preview')
  if (!selectedIds.length) {
    preview.innerHTML = '<span class="preview-empty">选择帧后可播放预览</span>'
    return
  }
  const frame = candidateById(selectedIds[previewIndex])
  preview.innerHTML = `<img src="${esc(frame?.url || '')}">`
  document.querySelectorAll('.selected-frame').forEach((item, index) => item.classList.toggle('active', index === previewIndex))
}

function showSelected(index) {
  previewIndex = index
  renderPreview()
}

function removeSelected(index) {
  selectedIds.splice(index, 1)
  previewIndex = Math.min(previewIndex, Math.max(0, selectedIds.length - 1))
  renderEditor()
  debounceSave()
}

function cloneCurrent() {
  if (!selectedIds.length) return toast('请先选择一帧')
  selectedIds.splice(previewIndex + 1, 0, selectedIds[previewIndex])
  previewIndex += 1
  renderEditor()
  debounceSave()
}

function bindSelectedDrag() {
  document.querySelectorAll('.selected-frame').forEach(item => {
    item.addEventListener('dragstart', () => { dragOrder = Number(item.dataset.order) })
    item.addEventListener('dragover', event => event.preventDefault())
    item.addEventListener('drop', event => {
      event.preventDefault()
      const target = Number(item.dataset.order)
      if (!Number.isInteger(dragOrder) || dragOrder === target) return
      const [moved] = selectedIds.splice(dragOrder, 1)
      selectedIds.splice(target, 0, moved)
      previewIndex = target
      dragOrder = null
      renderEditor()
      debounceSave()
    })
  })
}

function togglePlay() {
  if (playTimer) return stopPlay()
  if (!selectedIds.length) return
  document.getElementById('playBtn').textContent = 'Ⅱ'
  playTimer = setInterval(() => {
    previewIndex = (previewIndex + 1) % selectedIds.length
    renderPreview()
  }, Number(document.getElementById('speed').value))
}

function stopPlay() {
  clearInterval(playTimer)
  playTimer = null
  const button = document.getElementById('playBtn')
  if (button) button.textContent = '▶'
}

async function frameHash(url) {
  const image = await loadImage(url)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 8
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(image, 0, 0, 8, 8)
  const pixels = context.getImageData(0, 0, 8, 8).data
  const gray = Array.from({ length: 64 }, (_, index) => pixels[index * 4] * .299 + pixels[index * 4 + 1] * .587 + pixels[index * 4 + 2] * .114)
  const average = gray.reduce((sum, value) => sum + value, 0) / gray.length
  return gray.map(value => value >= average)
}

function distance(a, b) {
  return a.reduce((sum, value, index) => sum + (value === b[index] ? 0 : 1), 0)
}

async function autoDeduplicate(silent = false) {
  if (candidates.length < 2) return
  const hashes = []
  for (const frame of candidates) hashes.push(await frameHash(frame.url))
  const kept = []
  let previous = null
  for (let index = 0; index < candidates.length; index += 1) {
    if (!previous || distance(hashes[index], previous) > 5) {
      kept.push(candidates[index].id)
      previous = hashes[index]
    }
  }
  selectedIds = kept
  previewIndex = 0
  renderEditor()
  debounceSave()
  if (!silent) toast(`已保留 ${kept.length} 帧；疑似重复帧仍可在左侧手动选回`)
}

function editorPayload() {
  return {
    trimStart: Number(document.getElementById('trimStart').value || 0),
    trimEnd: Number(document.getElementById('trimEnd').value || 0),
    selectedIds,
    playbackMs: Number(document.getElementById('speed').value),
    candidateCount: candidates.length
  }
}

function patchDraft(payload) {
  if (!currentDraft) return Promise.resolve()
  const operation = saveChain.catch(() => {}).then(async () => {
    setSaveState('正在保存...')
    const result = await api(`/api/admin/frame-making/drafts/${currentDraft.id}`, {
      method: 'PATCH', body: JSON.stringify({ ...payload, revision: currentDraft.revision })
    })
    currentDraft.revision = result.revision
    setSaveState(`已自动保存 ${new Date(result.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`)
    return result
  })
  saveChain = operation.catch(error => {
    setSaveState(error.message, true)
    if (error.code === 'DRAFT_REVISION_CONFLICT') toast(error.message)
  })
  return operation
}

function debounceSave() {
  if (!currentDraft) return
  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => patchDraft({ editorData: editorPayload() }).catch(() => {}), 700)
}

function reloadSource() {
  if (currentDraft.sourceType === 'VIDEO') openVideoTrim()
  else if (currentDraft.sourceType === 'GIF') decodeGif()
  else loadImageSources()
}

function showEditor() {
  renderEditor()
  showView('editorView', 2)
}

function openMetadata() {
  if (!selectedIds.length) return toast('至少选择一帧')
  if (selectedIds.length > 50) return toast('正式动画最多保存 50 帧，请继续筛选')
  stopPlay()
  document.getElementById('metaTitle').value = currentDraft.title || ''
  document.getElementById('metaSource').value = currentDraft.sourceChannel || 'INTERNAL_CREATED'
  document.getElementById('metaUsage').value = currentDraft.usageType || 'INTERNAL_TEST'
  document.getElementById('metaRights').value = currentDraft.rightsHolderType || 'COMPANY'
  document.getElementById('metaAuth').value = currentDraft.authorizationStatus || 'PRIVATE_ONLY'
  document.getElementById('metaHolder').value = currentDraft.rightsHolderName || ''
  document.getElementById('metaContact').value = currentDraft.rightsHolderContact || ''
  document.getElementById('metaPhone').value = ''
  document.getElementById('metaTags').value = Array.isArray(currentDraft.tags) ? currentDraft.tags.join('，') : ''
  document.getElementById('metaNotes').value = currentDraft.internalNotes || ''
  document.getElementById('summaryDraft').textContent = currentDraft.draftNo
  document.getElementById('summaryRatio').textContent = currentDraft.targetRatio
  document.getElementById('summaryFrames').textContent = `${selectedIds.length} 帧`
  document.getElementById('summarySources').textContent = currentDraft.sourceType === 'IMAGES' ? `${currentDraft.sources.length} 张图片` : currentDraft.sourceType
  document.getElementById('summaryPreview').innerHTML = `<img src="${esc(candidateById(selectedIds[0])?.url || '')}">`
  const publish = document.getElementById('publishBtn')
  publish.disabled = currentUser.staffRole !== 'OWNER'
  document.getElementById('publishNotice').textContent = currentUser.staffRole === 'OWNER'
    ? '确认后生成正式 ANM 和 V1。草稿与原素材继续保留，正式版本不可覆盖。'
    : '您可以完成筛选和资料填写。只有负责人确认后，才会正式进入帧图资产库。'
  showView('metaView', 3)
}

function splitTags(value) {
  return [...new Set(String(value || '').split(/[，,]/).map(item => item.trim()).filter(Boolean))].slice(0, 30)
}

function metadataPayload() {
  return {
    title: document.getElementById('metaTitle').value,
    sourceChannel: document.getElementById('metaSource').value,
    usageType: document.getElementById('metaUsage').value,
    rightsHolderType: document.getElementById('metaRights').value,
    authorizationStatus: document.getElementById('metaAuth').value,
    rightsHolderName: document.getElementById('metaHolder').value,
    rightsHolderContact: document.getElementById('metaContact').value,
    ownerPhone: document.getElementById('metaPhone').value,
    tags: splitTags(document.getElementById('metaTags').value),
    internalNotes: document.getElementById('metaNotes').value,
    editorData: editorPayload()
  }
}

async function saveMetadataOrThrow(silent = false) {
  clearTimeout(autosaveTimer)
  const payload = metadataPayload()
  if (!payload.title.trim()) throw new Error('请填写动画名称')
  await patchDraft(payload)
  Object.assign(currentDraft, payload)
  if (!silent) toast('草稿资料已保存')
}

function saveMetadata(silent = false) {
  return saveMetadataOrThrow(silent).catch(error => {
    if (!silent) {
      toast(error.message)
      return null
    }
    throw error
  })
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('帧图读取失败'))
    image.src = url
  })
}

function ratioNumber(value) {
  const [width, height] = String(value || '1:1').split(':').map(Number)
  return width / height
}

async function frameFile(frame, index) {
  const image = await loadImage(frame.url)
  const ratio = ratioNumber(currentDraft.targetRatio)
  let sourceWidth = image.naturalWidth || image.width
  let sourceHeight = image.naturalHeight || image.height
  let sx = 0, sy = 0, sw = sourceWidth, sh = sourceHeight
  if (sourceWidth / sourceHeight > ratio) {
    sw = sourceHeight * ratio
    sx = (sourceWidth - sw) / 2
  } else {
    sh = sourceWidth / ratio
    sy = (sourceHeight - sh) / 2
  }
  const longSide = Math.min(1200, Math.max(sw, sh))
  const width = ratio >= 1 ? longSide : longSide * ratio
  const height = ratio >= 1 ? longSide / ratio : longSide
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  canvas.getContext('2d').drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .92))
  return new File([blob], `frame-${String(index + 1).padStart(3, '0')}.jpg`, { type: 'image/jpeg' })
}

async function publishAsset() {
  if (currentUser.staffRole !== 'OWNER') return toast('只有负责人可以确认入库')
  if (!selectedIds.length || selectedIds.length > 50) return toast('最终帧图需要 1 至 50 帧')
  const button = document.getElementById('publishBtn')
  button.disabled = true
  try {
    await saveMetadata(true)
    const uniqueIds = [...new Set(selectedIds)]
    const files = []
    for (let index = 0; index < uniqueIds.length; index += 1) files.push(await frameFile(candidateById(uniqueIds[index]), index))
    setSaveState('正在上传最终帧图...')
    const keys = await MowoPrivateUpload.uploadFiles({
      files, token, purpose: 'LIBRARY_FRAME',
      onProgress: (done, total) => setSaveState(`正在上传最终帧图 ${done}/${total}`)
    })
    const keyById = new Map(uniqueIds.map((id, index) => [id, keys[index]]))
    const result = await api(`/api/admin/frame-making/drafts/${currentDraft.id}/publish`, {
      method: 'POST', body: JSON.stringify({ frameKeys: selectedIds.map(id => keyById.get(id)) })
    })
    toast(`已生成 ${result.assetNo}`)
    setTimeout(() => { location.href = `admin-frame-library.html?keyword=${encodeURIComponent(result.assetNo)}` }, 700)
  } catch (error) {
    toast(error.message)
    button.disabled = false
  }
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open')
  document.getElementById('sidebarBackdrop').classList.add('show')
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open')
  document.getElementById('sidebarBackdrop').classList.remove('show')
}

document.getElementById('sourceInput').addEventListener('change', event => acceptFiles([...event.target.files]))
const dropZone = document.getElementById('dropZone')
dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('drag') })
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'))
dropZone.addEventListener('drop', event => { event.preventDefault(); dropZone.classList.remove('drag'); acceptFiles([...event.dataTransfer.files]) })
document.getElementById('trimStart').addEventListener('input', () => updateTrim('start'))
document.getElementById('trimEnd').addEventListener('input', () => updateTrim('end'))
document.getElementById('speed').addEventListener('input', event => {
  document.getElementById('speedText').textContent = `${event.target.value}ms`
  if (playTimer) { stopPlay(); togglePlay() }
  debounceSave()
})
window.addEventListener('beforeunload', () => clearTimeout(autosaveTimer))
document.addEventListener('DOMContentLoaded', init)
