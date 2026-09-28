const API_BASE = window.MOWO_API_BASE || ''
const token = localStorage.getItem('mowo_token') || ''
const MAX_GROUPS = 100
const MAX_FILES = 2000
const MAX_BYTES = 500 * 1024 * 1024
let groups = []
let selected = new Set()
let currentBatch = null
let historyRows = []
let clientRequestId = ''

function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]) }
function splitTags(value) { return [...new Set(String(value || '').split(/[，,]/).map(tag => tag.trim()).filter(Boolean))].slice(0, 30) }
function formatBytes(bytes) { return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB` }
function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-' }
function toast(message) { const el = document.getElementById('toast'); el.textContent = message; el.style.display = 'block'; clearTimeout(el._t); el._t = setTimeout(() => el.style.display = 'none', 2800) }
function auth(json = false) { return { Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) } }
async function api(path, options = {}) { const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...auth(Boolean(options.body)), ...(options.headers || {}) } }); const payload = await response.json().catch(() => ({})); if (!response.ok || !payload.success) throw new Error(payload.message || `请求失败（${response.status}）`); return payload.data }

function setStep(step) {
  document.querySelectorAll('.step').forEach((el, index) => { el.classList.toggle('active', index + 1 === step); el.classList.toggle('done', index + 1 < step) })
}

function defaults() {
  const customer = batchType.value === 'CUSTOMER'
  return {
    sourceChannel: customer ? 'OFFLINE_CUSTOM' : 'INTERNAL_CREATED',
    usageType: defaultUsage.value,
    rightsHolderType: customer ? 'OFFLINE_CUSTOMER' : 'COMPANY',
    rightsHolderName: defaultHolder.value.trim(), rightsHolderContact: defaultContact.value.trim(),
    authorizationStatus: defaultAuth.value, tags: splitTags(defaultTags.value), internalNotes: defaultNotes.value.trim()
  }
}

function applyTypeDefaults() {
  const customer = batchType.value === 'CUSTOMER'
  defaultUsage.value = customer ? 'PRIVATE_CUSTOM' : 'INTERNAL_TEST'
  defaultAuth.value = 'PRIVATE_ONLY'
  if (!customer) { defaultHolder.value = '哞屋'; defaultContact.value = '' }
}

function revokePreviews() { groups.forEach(group => { if (group.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(group.previewUrl) }) }
function startNewBatch() {
  revokePreviews(); groups = []; selected.clear(); currentBatch = null; clientRequestId = ''; folderInput.value = ''; batchType.disabled = false
  chooseFolderBtn.disabled = false
  uploadBtn.hidden = false; uploadBtn.disabled = true; preflightBtn.hidden = true; commitBtn.hidden = true; progress.hidden = true
  document.querySelectorAll('#setupPanel input,#setupPanel select').forEach(el => { if (el.id !== 'folderInput') el.disabled = false })
  applyTypeDefaults(); folderSummary.textContent = '尚未选择文件夹'; setStep(1); renderRows(); updateSummary()
}

function frameNumber(file) { const name = file.name.replace(/\.[^.]+$/, ''); return /^\d+$/.test(name) ? Number(name) : null }
function normalizeMime(file) { if (file.type) return file.type; return /\.png$/i.test(file.name) ? 'image/png' : /\.(jpe?g)$/i.test(file.name) ? 'image/jpeg' : '' }

function parseFolder(files) {
  revokePreviews(); groups = []; selected.clear(); currentBatch = null
  const map = new Map(); const errors = []; let totalBytes = 0
  for (const file of files) {
    const parts = String(file.webkitRelativePath || file.name).split('/').filter(Boolean)
    if (parts.length !== 3) { errors.push(`${file.webkitRelativePath || file.name} 不在第一层动画子文件夹内`); continue }
    const [, folderName] = parts
    const mime = normalizeMime(file); const order = frameNumber(file)
    if (!['image/png', 'image/jpeg'].includes(mime)) { errors.push(`${folderName}/${file.name} 不是 PNG/JPG`); continue }
    if (order === null) { errors.push(`${folderName}/${file.name} 没有使用数字文件名`); continue }
    totalBytes += file.size
    if (!map.has(folderName)) map.set(folderName, [])
    map.get(folderName).push(Object.assign(file, { _mime: mime, _order: order }))
  }
  if (errors.length) { folderSummary.textContent = errors.slice(0, 2).join('；'); toast(`发现 ${errors.length} 个目录或文件问题`); renderRows(); updateSummary(); return }
  if (map.size > MAX_GROUPS) return toast(`一次最多选择 ${MAX_GROUPS} 个动画文件夹`)
  if (files.length > MAX_FILES) return toast(`一次最多选择 ${MAX_FILES} 张图片`)
  if (totalBytes > MAX_BYTES) return toast('一次导入不能超过 500MB')
  const base = defaults()
  groups = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN', { numeric: true })).map(([folderName, frames], index) => {
    frames.sort((a, b) => a._order - b._order)
    const orders = frames.map(file => file._order)
    const issues = []
    if (frames.length < 2 || frames.length > 50) issues.push({ level: 'ERROR', message: '每套需要2至50张图片' })
    if (new Set(orders).size !== orders.length) issues.push({ level: 'ERROR', message: '存在重复帧序号' })
    if (orders.some((value, i) => i && value !== orders[i - 1] + 1)) issues.push({ level: 'WARNING', message: '帧序号不连续' })
    return { localId: String(index), folderName, relativePath: folderName, title: folderName, files: frames,
      previewUrl: URL.createObjectURL(frames[0]), tags: [...base.tags], ...base, issues, status: issues.some(x => x.level === 'ERROR') ? 'BLOCKED' : issues.length ? 'WARNING' : 'LOCAL' }
  })
  selected = new Set(groups.map(group => group.localId))
  clientRequestId = crypto.randomUUID()
  folderSummary.textContent = `${groups.length} 套动画 · ${files.length} 张图片 · ${formatBytes(totalBytes)}`
  applyDefaultsBtn.disabled = false; uploadBtn.disabled = groups.some(group => group.status === 'BLOCKED'); setStep(2); renderRows(); updateSummary()
}

function applyDefaultsToGroups() {
  const base = defaults()
  groups.forEach(group => Object.assign(group, { ...base, tags: [...base.tags] }))
  renderRows(); toast('共同资料已应用到全部动画')
}

function statusText(status) { return ({ LOCAL: '待上传', UPLOADING: '上传中', READY: '可入库', WARNING: '需要确认', BLOCKED: '无法入库', IMPORTED: '已入库', FAILED: '导入失败', SKIPPED_DUPLICATE: '重复已跳过' })[status] || status }
function usageOptions(value) { return [['INTERNAL_TEST','内部测试'],['UNDECIDED','暂未确定'],['COMPANY_PRODUCT','公司自营商品'],['PRIVATE_CUSTOM','私人定制']].map(([v,n]) => `<option value="${v}" ${value === v ? 'selected' : ''}>${n}</option>`).join('') }
function issueHtml(item) { const issues = item.issues || []; return issues.length ? `<div class="issues ${issues.some(x => x.level === 'ERROR') ? 'error' : ''}">${issues.map(x => esc(x.message)).join('<br>')}</div>` : '' }

function renderRows() {
  const rows = currentBatch?.items || groups
  if (!rows.length) { itemRows.innerHTML = '<tr><td colspan="8"><div class="empty">请选择包含动画子文件夹的总文件夹</div></td></tr>'; return }
  itemRows.innerHTML = rows.map((item, index) => {
    const id = item.id || item.localId; const locked = ['IMPORTED','SKIPPED_DUPLICATE'].includes(item.status); const preview = item.previewUrl
    return `<tr><td><input type="checkbox" ${selected.has(id) ? 'checked' : ''} onchange="toggleItem('${esc(id)}',this.checked)"></td><td><div class="thumb">${preview ? `<img src="${esc(preview)}">` : '无预览'}</div></td><td><input class="row-title" value="${esc(item.title)}" ${locked ? 'disabled' : ''} onchange="editItem(${index},'title',this.value)"><div style="font-size:9px;color:var(--muted);margin-top:4px">${esc(item.folderName)}</div></td><td><strong>${item.frameCount || item.files?.length || 0}</strong></td><td><input class="row-tags" value="${esc((item.tags || []).join(','))}" ${locked ? 'disabled' : ''} onchange="editItem(${index},'tags',this.value)"></td><td><select ${locked ? 'disabled' : ''} onchange="editItem(${index},'usageType',this.value)">${usageOptions(item.usageType)}</select></td><td><input class="row-holder" value="${esc(item.rightsHolderName || '')}" ${locked ? 'disabled' : ''} onchange="editItem(${index},'rightsHolderName',this.value)"></td><td><span class="status status-${String(item.status).toLowerCase()}">${esc(statusText(item.status))}</span>${item.assetNo ? `<div style="margin-top:5px"><a href="${window.MOWO_APP_BASE || '/app'}/admin/frame-library?keyword=${encodeURIComponent(item.assetNo)}">${esc(item.assetNo)}</a></div>` : ''}${issueHtml(item)}${item.duplicateAssetId && !locked ? `<label style="display:block;margin-top:6px"><input type="checkbox" ${item.allowDuplicate ? 'checked' : ''} onchange="editItem(${index},'allowDuplicate',this.checked)"> 仍然导入</label>` : ''}</td></tr>`
  }).join('')
}

function toggleItem(id, checked) { if (checked) selected.add(id); else selected.delete(id); selectAll.checked = selected.size === (currentBatch?.items || groups).length }
function toggleAll(checked) { const rows = currentBatch?.items || groups; selected = new Set(checked ? rows.map(item => item.id || item.localId) : []); renderRows() }
async function editItem(index, field, value) {
  const rows = currentBatch?.items || groups; const item = rows[index]; item[field] = field === 'tags' ? splitTags(value) : value
  if (!currentBatch) return
  try { await api(`/api/admin/frame-imports/${currentBatch.id}/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ [field]: item[field] }) }) }
  catch (error) { toast(error.message) }
}

async function bulkTags(mode) {
  const tags = splitTags(document.getElementById('bulkTags').value); if (!tags.length || !selected.size) return toast('请先选择项目并填写标签')
  if (!currentBatch) {
    groups.filter(item => selected.has(item.localId)).forEach(item => { const set = new Set(item.tags || []); tags.forEach(tag => mode === 'add' ? set.add(tag) : set.delete(tag)); item.tags = [...set] })
  } else {
    await api(`/api/admin/frame-imports/${currentBatch.id}/items`, { method: 'PATCH', body: JSON.stringify({ itemIds: [...selected], [mode === 'add' ? 'addTags' : 'removeTags']: tags }) })
    await loadBatch(currentBatch.id); return
  }
  renderRows()
}

async function bulkSetUsage() {
  const usageType = document.getElementById('bulkUsage').value; if (!usageType || !selected.size) return toast('请先选择项目和用途')
  if (!currentBatch) groups.filter(item => selected.has(item.localId)).forEach(item => { item.usageType = usageType })
  else { await api(`/api/admin/frame-imports/${currentBatch.id}/items`, { method: 'PATCH', body: JSON.stringify({ itemIds: [...selected], usageType }) }); await loadBatch(currentBatch.id); return }
  renderRows()
}

function setProgress(done, total, label) { progress.hidden = false; progressFill.style.width = `${total ? done / total * 100 : 0}%`; progressText.textContent = `${label} ${done}/${total}` }
async function uploadOne(job, file) {
  let put
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { put = await fetch(job.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file._mime || file.type }, body: file }) }
    catch (error) { if (attempt === 1) throw error; continue }
    if (put.ok || attempt === 1 || put.status < 500) break
  }
  if (!put?.ok) { const payload = await put?.json().catch(() => ({})) || {}; throw new Error(payload.message || `${file.name} 上传失败`) }
  const complete = await fetch(job.completeUrl, { method: 'POST', headers: auth() })
  const payload = await complete.json().catch(() => ({})); if (!complete.ok || !payload.success) throw new Error(payload.message || `${file.name} 校验失败`)
}

async function createAndUpload() {
  if (!groups.length) return toast('请先选择文件夹')
  const blocked = groups.find(group => group.status === 'BLOCKED'); if (blocked) return toast(`${blocked.folderName} 仍有阻断问题`)
  uploadBtn.disabled = true; setStep(3)
  try {
    const body = { clientRequestId: clientRequestId || (clientRequestId = crypto.randomUUID()), batchType: batchType.value, defaults: defaults(), groups: groups.map(group => ({
      folderName: group.folderName, relativePath: group.relativePath, title: group.title, tags: group.tags,
      sourceChannel: group.sourceChannel, usageType: group.usageType, rightsHolderType: group.rightsHolderType,
      rightsHolderName: group.rightsHolderName, rightsHolderContact: group.rightsHolderContact,
      authorizationStatus: group.authorizationStatus, internalNotes: group.internalNotes,
      files: group.files.map(file => ({ name: file.name, type: file._mime || file.type, size: file.size }))
    })) }
    const created = await api('/api/admin/frame-imports', { method: 'POST', body: JSON.stringify(body) })
    const localFiles = new Map(groups.flatMap(group => group.files.map(file => [`${group.folderName}\u0000${file.name}\u0000${file._order}`, file]))); let cursor = 0; let done = 0
    async function worker() { while (cursor < created.uploads.length) { const index = cursor++; const job = created.uploads[index]; const file = localFiles.get(`${job.folderName}\u0000${job.name}\u0000${job.order}`); if (!file) throw new Error(`无法匹配上传文件：${job.folderName}/${job.name}`); await uploadOne(job, file); done += 1; setProgress(done, created.uploads.length, '正在上传') } }
    await Promise.all(Array.from({ length: Math.min(4, created.uploads.length) }, () => worker()))
    setProgress(created.uploads.length, created.uploads.length, '正在检查')
    await api(`/api/admin/frame-imports/${created.id}/preflight`, { method: 'POST' })
    await loadBatch(created.id); await loadHistory(); toast('上传和预检完成')
  } catch (error) { toast(error.message); uploadBtn.disabled = false }
}

async function loadHistory() {
  const box = document.getElementById('history')
  try { historyRows = await api('/api/admin/frame-imports'); box.innerHTML = historyRows.length ? historyRows.map(row => `<div class="history-row" onclick="loadBatch('${esc(row.id)}')"><strong>${esc(row.batchNo)}</strong><div class="history-meta">${row.batchType === 'CUSTOMER' ? '客户素材' : '公司素材'} · ${row.totalItems}套 · ${statusText(row.status)}<br>${formatTime(row.createdAt)}</div></div>`).join('') : '<div class="empty">还没有导入批次</div>' } catch (error) { box.innerHTML = `<div class="empty">${esc(error.message)}</div>` }
}

async function loadBatch(id) {
  try {
    revokePreviews(); groups = []; currentBatch = await api(`/api/admin/frame-imports/${id}`); selected = new Set(currentBatch.items.filter(item => !['IMPORTED','SKIPPED_DUPLICATE'].includes(item.status)).map(item => item.id))
    const saved = currentBatch.defaults || {}
    batchType.value = currentBatch.batchType; defaultUsage.value = saved.usageType || 'INTERNAL_TEST'; defaultAuth.value = saved.authorizationStatus || 'PRIVATE_ONLY'; defaultHolder.value = saved.rightsHolderName || ''; defaultContact.value = saved.rightsHolderContact || ''; defaultTags.value = (saved.tags || []).join(','); defaultNotes.value = saved.internalNotes || ''
    batchType.disabled = true; chooseFolderBtn.disabled = true; document.querySelectorAll('#setupPanel input,#setupPanel select').forEach(el => { if (el.id !== 'folderInput') el.disabled = true })
    folderSummary.textContent = `${currentBatch.batchNo} · ${currentBatch.totalItems} 套 · ${currentBatch.totalFiles} 张 · ${formatBytes(currentBatch.totalBytes)}`
    const completed = currentBatch.status === 'COMPLETED'
    applyDefaultsBtn.disabled = true; uploadBtn.hidden = true; preflightBtn.hidden = completed; commitBtn.hidden = !currentBatch.items.some(item => ['READY','WARNING','FAILED'].includes(item.status)); setStep(completed ? 4 : 3); renderRows(); updateSummary()
  } catch (error) { toast(error.message) }
}

async function rerunPreflight() {
  if (!currentBatch) return
  preflightBtn.disabled = true
  try { await api(`/api/admin/frame-imports/${currentBatch.id}/preflight`, { method: 'POST' }); await loadBatch(currentBatch.id); await loadHistory(); toast('重新检查完成') }
  catch (error) { toast(error.message) } finally { preflightBtn.disabled = false }
}

async function commitItems() {
  const ids = [...selected].filter(id => currentBatch.items.some(item => item.id === id && ['READY','WARNING','FAILED'].includes(item.status)))
  if (!ids.length) return toast('没有可入库的已选项目')
  commitBtn.disabled = true; setStep(4)
  try { await api(`/api/admin/frame-imports/${currentBatch.id}/commit`, { method: 'POST', body: JSON.stringify({ itemIds: ids }) }); await loadBatch(currentBatch.id); await loadHistory(); toast('批量入库处理完成') }
  catch (error) { toast(error.message) } finally { commitBtn.disabled = false }
}

function updateSummary() {
  const rows = currentBatch?.items || groups
  sumItems.textContent = rows.length; sumFiles.textContent = currentBatch?.totalFiles || groups.reduce((sum, group) => sum + group.files.length, 0)
  sumReady.textContent = rows.filter(item => ['LOCAL','READY','WARNING','IMPORTED'].includes(item.status)).length
  sumReadyLabel.textContent = currentBatch?.status === 'COMPLETED' ? '已入库' : '可入库'
  sumProblems.textContent = rows.filter(item => ['BLOCKED','FAILED'].includes(item.status)).length
}

async function init() {
  if (!token) return location.replace('auth.html?redirect=' + encodeURIComponent(location.pathname))
  try { const user = await api('/api/v1/account/me'); if (user.staffRole !== 'OWNER') return location.replace('index.html') }
  catch { return location.replace('auth.html?redirect=' + encodeURIComponent(location.pathname)) }
  applyTypeDefaults(); await loadHistory()
  const id = new URLSearchParams(location.search).get('batchId'); if (id) await loadBatch(id)
}

folderInput.addEventListener('change', event => parseFolder([...event.target.files]))
init()
