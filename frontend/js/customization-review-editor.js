(function () {
  'use strict'

  const params = new URLSearchParams(location.search)
  const adminRequestId = params.get('adminRequestId')
  const alreadyClaimed = params.get('claimed') === '1'
  if (!adminRequestId) return

  const API = window.MOWO_API_BASE || ''
  const token = localStorage.getItem('mowo_token') || ''
  let task = null
  let pendingDraft = null
  let draftApplied = false
  let saveTimer = null
  let heartbeatTimer = null

  function parseList(value, fallback) {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value
      return Array.isArray(parsed) && parsed.length ? parsed : fallback
    } catch {
      if (typeof value === 'string') {
        const parts = value.split(',').map(item => item.trim()).filter(Boolean)
        if (parts.length) return parts
      }
      return fallback
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      }
    })
    let result
    try { result = await response.json() } catch { result = { success: false, message: '服务器返回了无法识别的内容' } }
    if (!response.ok || !result.success) throw new Error(result.message || '操作失败')
    return result.data
  }

  function showFatal(message) {
    goState(S.UPLOAD)
    const upload = document.getElementById('stateUpload')
    upload.innerHTML = `<div style="max-width:680px;margin:70px auto;padding:32px;background:#fff;border:1px solid #ddd;text-align:center"><h2 style="font-size:22px;margin-bottom:12px">无法打开筛帧任务</h2><p style="color:#777;font-weight:700;line-height:1.7">${escapeHtml(message)}</p><a href="admin-customization-requests.html" style="display:inline-flex;margin-top:22px;padding:12px 22px;background:#111;color:#fff;text-decoration:none;font-weight:900">返回列表</a></div>`
  }

  function escapeHtml(value) {
    const node = document.createElement('div')
    node.textContent = String(value || '')
    return node.innerHTML
  }

  function applyModel(model) {
    if (!model) throw new Error('该任务关联的款式不存在')
    machineName = model.name || '定制款式'
    machineType = model.modelType || 'standard'
    allowedFrames = parseList(model.frameOptions, [12, 16, 24]).map(Number).filter(Number.isFinite)
    allowedRatios = parseList(model.ratios, ['1:1'])
    document.getElementById('targetTxt').textContent = `${allowedFrames.join(' / ')} 帧`
    document.getElementById('ebarTargets').innerHTML = allowedFrames.map(value => `<span class="ebar-tgt" id="tgt${value}">${value} 帧</span>`).join('')
    localStorage.setItem('mowo_customize_meta', JSON.stringify({
      id: model.id, name: machineName, frames: allowedFrames, ratios: allowedRatios, modelType: machineType
    }))
  }

  function addModeBar(label, detail) {
    const bar = document.createElement('div')
    bar.id = 'reviewModeBar'
    bar.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:5000;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 32px);padding:9px 14px;background:#111;color:#fff;border-radius:7px;box-shadow:0 8px 25px rgba(0,0,0,.18);font:800 12px/1.4 Nunito,"Noto Sans SC",sans-serif'
    bar.innerHTML = `<strong style="color:#F5E642;white-space:nowrap">${escapeHtml(label)}</strong><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(detail)}</span>`
    document.body.appendChild(bar)
  }

  async function downloadSource(file, index) {
    const response = await fetch(file.url)
    if (!response.ok) throw new Error(`第 ${index + 1} 个原素材读取失败`)
    const blob = await response.blob()
    const type = file.mimeType || file.type || blob.type || 'application/octet-stream'
    return new File([blob], file.filename || file.name || `source-${index + 1}`, { type })
  }

  async function waitForUploadReady() {
    for (let count = 0; count < 80; count += 1) {
      if (!btnStart.disabled) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('原素材准备超时，请返回任务列表重新进入')
  }

  function addAdminActions() {
    document.querySelector('.ebar-back-btn').textContent = '退回任务池'
    document.getElementById('btnNextStep').textContent = '提交给用户'
    const next = document.createElement('button')
    next.className = 'btn btn-yellow btn-sm'
    next.id = 'btnSubmitNextTask'
    next.textContent = '提交并下一条'
    next.disabled = true
    next.addEventListener('click', () => openSubmitDialog(true))
    document.getElementById('btnNextStep').insertAdjacentElement('afterend', next)
    const primary = document.getElementById('btnNextStep')
    new MutationObserver(() => { next.disabled = primary.disabled }).observe(primary, { attributes:true, attributeFilter:['disabled'] })
  }

  async function loadAdminTask() {
    if (!token) throw new Error('请先登录工作人员账号')
    if (!alreadyClaimed) {
      await api(`/api/admin/customization-requests/${encodeURIComponent(adminRequestId)}/claim`, { method: 'POST' })
    }
    task = await api(`/api/admin/customization-requests/${encodeURIComponent(adminRequestId)}`)
    if (!task.canEdit) throw new Error('当前岗位只能查看任务，不能进入筛帧编辑')
    if (!task.sourceFiles?.length) throw new Error('任务没有可读取的原素材')
    applyModel(task.model)
    pendingDraft = task.staffDraftData || null
    addModeBar('后台筛帧', `${task.requestNo} · ${task.user.nickname} · ${task.model.name}`)
    addAdminActions()
    goState(S.LOAD)
    document.getElementById('loadingStatus').textContent = '正在读取用户原素材'
    const files = await Promise.all(task.sourceFiles.map(downloadSource))
    goState(S.UPLOAD)
    handleFiles(files)
    await waitForUploadReady()
    btnStart.click()
    saveTimer = setInterval(saveStaffDraft, 15000)
    heartbeatTimer = setInterval(sendHeartbeat, 4 * 60 * 1000)
  }

  async function saveStaffDraft() {
    if (!adminRequestId || curState !== S.EDIT) return
    try {
      await api(`/api/admin/customization-requests/${encodeURIComponent(adminRequestId)}/frame-draft`, {
        method: 'PUT',
        body: JSON.stringify({ selectedIndexes: checkedIdx(), trimStart, trimEnd })
      })
    } catch (error) {
      console.warn('筛帧草稿自动保存失败：', error.message)
    }
  }

  async function sendHeartbeat() {
    try {
      await api(`/api/admin/customization-requests/${encodeURIComponent(adminRequestId)}/heartbeat`, { method: 'POST' })
    } catch (error) {
      clearInterval(saveTimer)
      clearInterval(heartbeatTimer)
      alert(`任务编辑权已失效：${error.message}`)
    }
  }

  function onEditorReady() {
    if (pendingDraft && !draftApplied) {
      let selected = Array.isArray(pendingDraft.selectedIndexes) ? pendingDraft.selectedIndexes : []
      if (!selected.length && Array.isArray(pendingDraft.selectedIds)) {
        selected = pendingDraft.selectedIds.map(value => Number(String(value).match(/(\d+)$/)?.[1])).filter(Number.isInteger)
      }
      if (selected.length) {
        const keep = new Set(selected.filter(index => index >= 0 && index < frames.length))
        checked = frames.map((_, index) => keep.has(index))
        frames.forEach((_, index) => setThumbState(index))
        updateAll()
      }
      draftApplied = true
    }
    if (adminRequestId) document.getElementById('btnSubmitNextTask').disabled = document.getElementById('btnNextStep').disabled
  }

  function submitDialog() {
    let overlay = document.getElementById('staffSubmitDialog')
    if (overlay) return overlay
    overlay = document.createElement('div')
    overlay.id = 'staffSubmitDialog'
    overlay.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:20px'
    overlay.innerHTML = `<section style="width:min(560px,100%);background:#fff;border-radius:8px;padding:24px;font-family:Nunito,'Noto Sans SC',sans-serif">
      <h2 style="font-size:21px;margin:0 0 6px">提交筛帧结果</h2>
      <p style="font-size:12px;color:#777;font-weight:700;margin:0 0 18px">用户会看到公开说明；内部备注只供工作人员查看。</p>
      <label style="display:block;font-weight:900;font-size:12px;margin-bottom:6px">给用户的说明（选填）</label>
      <textarea id="staffPublicMessage" maxlength="1000" placeholder="例如：已优先保留动作完整、画面清晰的帧" style="width:100%;height:84px;resize:vertical;padding:10px;border:1px solid #ccc;font:700 13px inherit"></textarea>
      <label style="display:block;font-weight:900;font-size:12px;margin:14px 0 6px">内部备注（选填）</label>
      <textarea id="staffInternalNote" maxlength="2000" placeholder="交接信息，不会展示给用户" style="width:100%;height:72px;resize:vertical;padding:10px;border:1px solid #ccc;font:700 13px inherit"></textarea>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button id="staffSubmitCancel" class="btn btn-secondary btn-sm">取消</button><button id="staffSubmitConfirm" class="btn btn-yellow btn-sm">确认提交</button></div>
    </section>`
    document.body.appendChild(overlay)
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.style.display = 'none' })
    document.getElementById('staffSubmitCancel').onclick = () => { overlay.style.display = 'none' }
    return overlay
  }

  function openSubmitDialog(next) {
    const selectedIndexes = checkedIdx()
    const validTargets = allowedFrames.filter(value => value >= selectedIndexes.length && selectedIndexes.length > 0 && value % selectedIndexes.length === 0)
    if (!validTargets.length) return showToast('当前帧数不符合该款式要求')
    const overlay = submitDialog()
    overlay.style.display = 'flex'
    document.getElementById('staffSubmitConfirm').onclick = () => submitAdminResult({
      next,
      selectedIndexes,
      selectedUrls: selectedIndexes.map(index => frames[index]),
      frameCount: selectedIndexes.length,
      validTargets
    })
  }

  async function submitAdminResult(payload) {
    const button = document.getElementById('staffSubmitConfirm')
    button.disabled = true
    button.textContent = '正在上传'
    try {
      const frameKeys = await window.MowoPrivateUpload.uploadSources({
        sources: payload.selectedUrls, token, purpose: 'CUSTOMIZATION_FRAME',
        onProgress: (done, total) => { button.textContent = `上传 ${done}/${total}` }
      })
      button.textContent = '正在提交'
      const result = await api(`/api/admin/customization-requests/${encodeURIComponent(adminRequestId)}/frame-selections`, {
        method: 'POST',
        body: JSON.stringify({
          frameKeys,
          editorData: { selectedIndexes: payload.selectedIndexes, trimStart, trimEnd, frameCount: payload.frameCount, validTargets: payload.validTargets },
          staffMessage: document.getElementById('staffPublicMessage').value,
          internalNote: document.getElementById('staffInternalNote').value,
          next: payload.next
        })
      })
      clearInterval(saveTimer)
      clearInterval(heartbeatTimer)
      if (payload.next && result.next?.id) {
        location.replace(`customize-editor.html?adminRequestId=${encodeURIComponent(result.next.id)}&claimed=1`)
      } else {
        location.href = `admin-customization-requests.html?submitted=${encodeURIComponent(task.requestNo)}`
      }
    } catch (error) {
      alert(`提交失败：${error.message}`)
      button.disabled = false
      button.textContent = '确认提交'
    }
  }

  async function handleNext() {
    openSubmitDialog(false)
  }

  async function handleBack() {
    if (!confirm('退回后，其他工作人员可以领取这条任务。确定退回吗？')) return
    try {
      await api(`/api/admin/customization-requests/${encodeURIComponent(adminRequestId)}/release`, { method: 'POST' })
      location.href = 'admin-customization-requests.html'
    } catch (error) {
      alert(`退回失败：${error.message}`)
    }
  }

  window.MowoCustomizationReview = { active: true, onEditorReady, handleNext, handleBack }
  goState(S.LOAD)
  loadAdminTask().catch(error => showFatal(error.message))
})()
