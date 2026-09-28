(function () {
  'use strict'

  const params = new URLSearchParams(location.search)
  const adminRequestId = params.get('adminRequestId')
  const frameDraftId = params.get('frameDraftId')
  if (!adminRequestId && !frameDraftId) return

  const API = window.MOWO_API_BASE || ''
  const token = localStorage.getItem('mowo_token') || ''
  let task = null
  let pendingDraft = null
  let draftApplied = false
  let saveTimer = null
  let heartbeatTimer = null
  let frameDraft = null
  let frameUser = null

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
    const returnPage = frameDraftId ? 'admin-frame-making.html' : 'admin-customization-requests.html'
    upload.innerHTML = `<div style="max-width:680px;margin:70px auto;padding:32px;background:#fff;border:1px solid #ddd;text-align:center"><h2 style="font-size:22px;margin-bottom:12px">无法打开筛帧任务</h2><p style="color:#777;font-weight:700;line-height:1.7">${escapeHtml(message)}</p><a href="${returnPage}" style="display:inline-flex;margin-top:22px;padding:12px 22px;background:#111;color:#fff;text-decoration:none;font-weight:900">返回列表</a></div>`
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

  function applyFrameMakingChrome() {
    document.body.classList.add('admin-frame-editor')
    document.documentElement.style.setProperty('--nav-h', '0px')
    document.title = `${frameDraft.draftNo} - 后台帧图制作`
    const style = document.createElement('style')
    style.textContent = `
      .admin-frame-editor .progress-steps{top:0;background:#fff;border-bottom:1px solid #ddd}
      .admin-frame-editor #reviewModeBar{top:68px}
      .admin-frame-editor .progress-back{color:#111}
      .admin-frame-editor .step-item.active .step-num{background:#111;color:#F5E642}
      .admin-frame-editor .step-item.done .step-num{background:#111;color:#fff}
    `
    document.head.appendChild(style)
    document.querySelector('.progress-steps').innerHTML = `
      <a class="progress-back" href="admin-frame-making.html" title="返回帧图制作" aria-label="返回帧图制作">
        <span class="progress-back-arrow" aria-hidden="true">←</span><span class="progress-back-label">保存并返回</span>
      </a>
      <div class="step-item done"><div class="step-num">1</div><span class="step-label">导入原素材</span></div>
      <div class="step-divider"></div>
      <div class="step-item active"><div class="step-num">2</div><span class="step-label">筛选与编辑</span></div>
      <div class="step-divider"></div>
      <div class="step-item"><div class="step-num">3</div><span class="step-label">确认入库</span></div>`
    document.querySelector('.progress-back').addEventListener('click', event => {
      event.preventDefault()
      handleBack()
    })
    machineName = '后台帧图资产'
    machineType = 'frame-library'
    allowedFrames = []
    allowedRatios = [frameDraft.targetRatio || '1:1']
    document.getElementById('targetTxt').textContent = '1 - 50 帧'
    document.getElementById('ebarTargets').innerHTML = '<span class="ebar-tgt">正式动画 1 - 50 帧</span>'
    document.querySelector('.ebar-back-btn').textContent = '保存并返回'
    document.getElementById('btnNextStep').textContent = frameUser.staffRole === 'OWNER' ? '填写入库资料' : '提交负责人确认'
    addModeBar('后台帧图制作', `${frameDraft.draftNo} · ${frameDraft.title}`)
  }

  async function loadFrameDraft() {
    if (!token) throw new Error('请先登录工作人员账号')
    frameUser = await api('/api/v1/account/me')
    if (!frameUser.staffRole && Number(frameUser.role) >= 3) frameUser.staffRole = 'OWNER'
    if (!['OWNER', 'PRODUCTION'].includes(frameUser.staffRole)) throw new Error('当前账号没有帧图制作权限')
    frameDraft = await api(`/api/admin/frame-making/drafts/${encodeURIComponent(frameDraftId)}`)
    if (!['DRAFT', 'READY_FOR_REVIEW'].includes(frameDraft.status)) throw new Error('该草稿已入库或已经放弃')
    if (frameDraft.status === 'READY_FOR_REVIEW' && frameUser.staffRole !== 'OWNER') {
      throw new Error('该草稿已提交负责人确认，生产人员不能继续修改')
    }
    if (!frameDraft.sources?.length) throw new Error('草稿没有可读取的原素材')
    pendingDraft = frameDraft.editorData || null
    applyFrameMakingChrome()
    goState(S.LOAD)
    document.getElementById('loadingStatus').textContent = '正在读取后台原素材'
    const files = await Promise.all(frameDraft.sources.map(downloadSource))
    goState(S.UPLOAD)
    handleFiles(files)
    await waitForUploadReady()
    btnStart.click()
    if (frameDraft.sourceType === 'VIDEO' && pendingDraft) {
      for (let count = 0; count < 80 && curState !== S.TRIM; count += 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (curState === S.TRIM) {
        const savedStart = Number(pendingDraft.trimStart)
        const savedEnd = Number(pendingDraft.trimEnd)
        if (Number.isFinite(savedStart)) trimStart = Math.max(0, Math.min(savedStart, trimDuration))
        if (Number.isFinite(savedEnd)) trimEnd = Math.max(trimStart + 0.5, Math.min(savedEnd, trimDuration))
        updateTrimUI(false)
      }
    }
    saveTimer = setInterval(() => saveFrameDraft({ quiet: true }), 15000)
  }

  async function loadAdminTask() {
    if (!token) throw new Error('请先登录工作人员账号')
    await api(`/api/admin/customization-requests/${encodeURIComponent(adminRequestId)}/claim`, { method: 'POST' })
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

  function frameDraftEditorData() {
    const data = {
      ...(frameDraft?.editorData || {}),
      trimStart,
      trimEnd,
      playbackValue: Number(document.getElementById('speedSlider')?.value || 0)
    }
    if (curState === S.EDIT) {
      data.selectedIndexes = checkedIdx()
      data.frameCount = data.selectedIndexes.length
    }
    return data
  }

  async function saveFrameDraft({ quiet = false, metadata = null } = {}) {
    if (!frameDraftId || !frameDraft || ![S.EDIT, S.TRIM].includes(curState)) return frameDraft
    try {
      const data = await api(`/api/admin/frame-making/drafts/${encodeURIComponent(frameDraftId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          revision: frameDraft.revision,
          editorData: frameDraftEditorData(),
          ...(metadata || {})
        })
      })
      frameDraft = { ...frameDraft, ...(metadata || {}), editorData: frameDraftEditorData(), revision: data.revision }
      if (!quiet) showToast('草稿已保存')
      return frameDraft
    } catch (error) {
      if (!quiet) throw error
      console.warn('帧图制作草稿自动保存失败：', error.message)
      return frameDraft
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
    if ((adminRequestId || frameDraftId) && pendingDraft && !draftApplied) {
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
      const speed = Number(pendingDraft.playbackValue)
      if (frameDraftId && Number.isFinite(speed) && document.getElementById('speedSlider')) {
        document.getElementById('speedSlider').value = String(speed)
        document.getElementById('speedSlider').dispatchEvent(new Event('input'))
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
        location.replace(`customize-editor.html?adminRequestId=${encodeURIComponent(result.next.id)}`)
      } else {
        location.href = `admin-customization-requests.html?submitted=${encodeURIComponent(task.requestNo)}`
      }
    } catch (error) {
      alert(`提交失败：${error.message}`)
      button.disabled = false
      button.textContent = '确认提交'
    }
  }

  function frameMetadataDialog() {
    let overlay = document.getElementById('frameMetadataDialog')
    if (overlay) return overlay
    overlay = document.createElement('div')
    overlay.id = 'frameMetadataDialog'
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.58);display:none;align-items:center;justify-content:center;padding:18px;overflow:auto'
    overlay.innerHTML = `<section style="width:min(720px,100%);max-height:calc(100vh - 36px);overflow:auto;background:#fff;border-radius:8px;padding:24px;font-family:Nunito,'Noto Sans SC',sans-serif">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px"><div><h2 style="font-size:22px;margin:0 0 5px">确认资料并加入资产库</h2><p id="frameMetaCount" style="margin:0;color:#777;font-size:12px;font-weight:800"></p></div><button id="frameMetaClose" class="btn btn-secondary btn-sm">取消</button></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px">
        <label style="grid-column:1/-1;font-weight:900;font-size:12px">动画名称<input id="fmTitle" maxlength="200" style="display:block;width:100%;margin-top:6px;padding:11px;border:1px solid #ccc" /></label>
        <label style="font-weight:900;font-size:12px">素材来源<select id="fmSourceChannel" style="display:block;width:100%;margin-top:6px;padding:11px;border:1px solid #ccc"><option value="INTERNAL_CREATED">哞屋自行制作</option><option value="OFFLINE_CUSTOM">线下客户定制</option><option value="CREATOR_SUBMISSION">创作者提供</option></select></label>
        <label style="font-weight:900;font-size:12px">当前用途<select id="fmUsageType" style="display:block;width:100%;margin-top:6px;padding:11px;border:1px solid #ccc"><option value="INTERNAL_TEST">内部测试</option><option value="COMPANY_PRODUCT">哞屋自有商品</option><option value="PRIVATE_CUSTOM">私人定制</option><option value="COLLAB_SALE">联名销售</option><option value="UNDECIDED">暂未确定</option></select></label>
        <label style="font-weight:900;font-size:12px">权利主体<select id="fmRightsType" style="display:block;width:100%;margin-top:6px;padding:11px;border:1px solid #ccc"><option value="COMPANY">哞屋</option><option value="OFFLINE_CUSTOMER">线下客户</option><option value="CREATOR">创作者</option><option value="USER">网站用户</option><option value="UNCONFIRMED">待确认</option></select></label>
        <label style="font-weight:900;font-size:12px">授权状态<select id="fmAuthStatus" style="display:block;width:100%;margin-top:6px;padding:11px;border:1px solid #ccc"><option value="PRIVATE_ONLY">仅限私人订单</option><option value="PENDING">授权待确认</option><option value="AUTHORIZED">已取得授权</option></select></label>
        <label style="font-weight:900;font-size:12px">客户或权利人名称<input id="fmRightsName" maxlength="120" style="display:block;width:100%;margin-top:6px;padding:11px;border:1px solid #ccc" /></label>
        <label style="font-weight:900;font-size:12px">联系方式（选填）<input id="fmRightsContact" maxlength="200" style="display:block;width:100%;margin-top:6px;padding:11px;border:1px solid #ccc" /></label>
        <label style="font-weight:900;font-size:12px">绑定网站账号手机号（选填）<input id="fmOwnerPhone" maxlength="20" placeholder="线下客户以后也可以再绑定" style="display:block;width:100%;margin-top:6px;padding:11px;border:1px solid #ccc" /></label>
        <label style="font-weight:900;font-size:12px">标签（逗号分隔）<input id="fmTags" maxlength="500" style="display:block;width:100%;margin-top:6px;padding:11px;border:1px solid #ccc" /></label>
        <label style="grid-column:1/-1;font-weight:900;font-size:12px">内部备注（不会展示给用户）<textarea id="fmNotes" maxlength="4000" style="display:block;width:100%;height:74px;margin-top:6px;padding:11px;border:1px solid #ccc;resize:vertical"></textarea></label>
      </div>
      <p style="margin:14px 0 0;color:#777;font-size:12px;font-weight:700;line-height:1.6">私人客户或未确认授权的素材只能用于对应私人订单；进入资料库不代表可以公开销售或重复使用。</p>
      <div style="display:flex;justify-content:flex-end;margin-top:18px"><button id="frameMetaPublish" class="btn btn-yellow">确认并加入资产库</button></div>
    </section>`
    document.body.appendChild(overlay)
    document.getElementById('frameMetaClose').onclick = () => { overlay.style.display = 'none' }
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.style.display = 'none' })
    return overlay
  }

  function openFrameMetadata(payload) {
    const overlay = frameMetadataDialog()
    document.getElementById('frameMetaCount').textContent = `${frameDraft.draftNo} · 已选择 ${payload.frameCount} 帧`
    document.getElementById('fmTitle').value = frameDraft.title || ''
    document.getElementById('fmSourceChannel').value = frameDraft.sourceChannel || 'INTERNAL_CREATED'
    document.getElementById('fmUsageType').value = frameDraft.usageType || 'INTERNAL_TEST'
    document.getElementById('fmRightsType').value = frameDraft.rightsHolderType || 'COMPANY'
    document.getElementById('fmAuthStatus').value = frameDraft.authorizationStatus || 'PRIVATE_ONLY'
    document.getElementById('fmRightsName').value = frameDraft.rightsHolderName || '哞屋'
    document.getElementById('fmRightsContact').value = frameDraft.rightsHolderContact || ''
    document.getElementById('fmTags').value = Array.isArray(frameDraft.tags) ? frameDraft.tags.join('，') : ''
    document.getElementById('fmNotes').value = frameDraft.internalNotes || ''
    overlay.style.display = 'flex'
    document.getElementById('frameMetaPublish').onclick = () => publishFrameDraft(payload)
  }

  async function submitFrameDraftReview(button) {
    button.disabled = true
    button.textContent = '正在保存草稿'
    try {
      await saveFrameDraft()
      button.textContent = '正在提交负责人'
      const result = await api(`/api/admin/frame-making/drafts/${encodeURIComponent(frameDraftId)}/submit-review`, {
        method: 'POST', body: JSON.stringify({ revision: frameDraft.revision })
      })
      frameDraft.revision = result.revision || frameDraft.revision
      clearInterval(saveTimer)
      location.href = `admin-frame-making.html?submitted=${encodeURIComponent(frameDraft.draftNo)}`
    } catch (error) {
      alert(`提交失败：${error.message}`)
      button.disabled = false
      button.textContent = '提交负责人确认'
    }
  }

  async function publishFrameDraft(payload) {
    const button = document.getElementById('frameMetaPublish')
    const metadata = {
      title: document.getElementById('fmTitle').value,
      sourceChannel: document.getElementById('fmSourceChannel').value,
      usageType: document.getElementById('fmUsageType').value,
      rightsHolderType: document.getElementById('fmRightsType').value,
      authorizationStatus: document.getElementById('fmAuthStatus').value,
      rightsHolderName: document.getElementById('fmRightsName').value,
      rightsHolderContact: document.getElementById('fmRightsContact').value,
      ownerPhone: document.getElementById('fmOwnerPhone').value,
      tags: document.getElementById('fmTags').value.split(/[，,]/).map(value => value.trim()).filter(Boolean),
      internalNotes: document.getElementById('fmNotes').value
    }
    button.disabled = true
    button.textContent = '正在保存资料'
    try {
      await saveFrameDraft({ metadata })
      button.textContent = '正在上传正式帧图'
      const frameKeys = await window.MowoPrivateUpload.uploadSources({
        sources: payload.selectedUrls,
        token,
        purpose: 'LIBRARY_FRAME',
        onProgress: (done, total) => { button.textContent = `上传正式帧图 ${done}/${total}` }
      })
      button.textContent = '正在生成资产编号'
      const result = await api(`/api/admin/frame-making/drafts/${encodeURIComponent(frameDraftId)}/publish`, {
        method: 'POST', body: JSON.stringify({ frameKeys })
      })
      clearInterval(saveTimer)
      location.href = `${window.MOWO_APP_BASE || '/app'}/admin/frame-library?keyword=${encodeURIComponent(result.assetNo)}`
    } catch (error) {
      alert(`入库失败：${error.message}`)
      button.disabled = false
      button.textContent = '确认并加入资产库'
    }
  }

  async function handleNext(payload) {
    if (frameDraftId) {
      if (frameUser.staffRole === 'OWNER') openFrameMetadata(payload)
      else await submitFrameDraftReview(document.getElementById('btnNextStep'))
      return
    }
    if (adminRequestId) {
      openSubmitDialog(false)
    }
  }

  async function handleBack() {
    if (frameDraftId) {
      try {
        await saveFrameDraft()
        clearInterval(saveTimer)
        location.href = 'admin-frame-making.html'
      } catch (error) {
        if (confirm(`草稿保存失败：${error.message}\n仍然返回列表吗？`)) location.href = 'admin-frame-making.html'
      }
      return
    }
    if (!adminRequestId) return
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
  ;(frameDraftId ? loadFrameDraft() : loadAdminTask()).catch(error => showFatal(error.message))
})()
