(function () {
  const S = window.MowoScan
  const BATCH_KEY = 'mowo_production_active_batch'
  const HISTORY_KEY = 'mowo_production_scan_history'
  const stations = {
    overview: '扫码作业总览',
    frame: '帧包完成',
    material: '材料领用',
    pairing: '单件配对',
    packing: '装箱发货'
  }
  const requestedStation = new URLSearchParams(location.search).get('station')
  const state = {
    station: stations[requestedStation] ? requestedStation : 'overview',
    batchId: sessionStorage.getItem(BATCH_KEY) || '', overview: null, queue: null,
    materialSource: null, pairingSource: null, trackingNo: '', packingData: null,
    history: loadHistory()
  }

  function el(id) { return document.getElementById(id) }
  function loadHistory() { try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '{}') } catch { return {} } }
  function saveHistory() { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(state.history)) }
  function rows(name) { return Array.isArray(state.history[name]) ? state.history[name] : [] }
  function remember(name, item, uniqueKey = 'code') {
    const list = rows(name)
    const existing = list.find(row => row[uniqueKey] === item[uniqueKey])
    if (existing) { Object.assign(existing, item); existing.repeats = Number(existing.repeats || 0) + 1 }
    else list.unshift({ ...item, repeats: item.repeated ? 1 : 0 })
    state.history[name] = list.slice(0, 20)
    saveHistory()
  }
  function requireBatch() { if (!state.batchId) throw new Error('请先选择当前生产批次'); return state.batchId }
  function setResult(node, kind, html) { node.className = `result ${kind || ''} flash`; node.innerHTML = html }
  function currentBatchInfo() { return state.overview?.batches?.find(batch => batch.id === state.batchId) }

  async function loadOverview() {
    state.overview = await S.request('/api/admin/production-workflow/scan-overview')
    el('globalBatch').innerHTML = `<option value="">请选择生产批次</option>${state.overview.batches.map(batch => `<option value="${S.esc(batch.id)}">${S.esc(batch.id)} · ${batch.paired}/${batch.total} 已配对</option>`).join('')}`
    if (state.batchId && !state.overview.batches.some(batch => batch.id === state.batchId)) {
      state.batchId = ''
      sessionStorage.removeItem(BATCH_KEY)
      clearBatchViews()
    }
    el('globalBatch').value = state.batchId
    renderBatchContext()
    renderOverview()
  }
  function renderBatchContext() {
    const batch = currentBatchInfo()
    el('batchSelectionState').textContent = batch ? `${batch.total} 件` : '未选择'
  }
  function renderOverview() {
    const batch = currentBatchInfo()
    el('frameTotal').textContent = batch?.frameCompleted || 0
    el('materialTotal').textContent = batch?.materialPicked || 0
    el('pairedTotal').textContent = batch?.paired || 0
    el('packedTotal').textContent = batch?.packaged || 0
    el('overviewBatch').innerHTML = batch
      ? `<div class="progress-line"><span>帧包 ${batch.frameCompleted}/${batch.total}</span><span>领料 ${batch.materialPicked}/${batch.total}</span><span>配对 ${batch.paired}/${batch.total}</span><span>装箱 ${batch.packaged}/${batch.total}</span></div><div class="actions"><a class="btn" href="admin-production-batches.html?batchId=${encodeURIComponent(batch.id)}">查看批次详情</a><button class="btn" id="downloadLedger">下载最新生产总表</button></div>`
      : '<div class="empty">请先选择生产批次</div>'
    if (el('downloadLedger')) el('downloadLedger').onclick = downloadLedger
    el('serverRecent').innerHTML = state.overview.recent.length
      ? state.overview.recent.slice(0, 12).map(row => `<div class="row"><div><div class="row-title">${S.esc(row.action || '生产操作')}</div><div class="row-meta">${S.formatTime(row.createdAt)}</div></div></div>`).join('')
      : '<div class="empty">暂无记录</div>'
  }
  async function downloadLedger() {
    try {
      const batchId = requireBatch()
      const response = await fetch(`${S.API}/api/admin/production-workflow/batches/${encodeURIComponent(batchId)}/production-ledger`, { headers: S.auth() })
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.message || '生产总表下载失败') }
      const a = document.createElement('a')
      a.href = URL.createObjectURL(await response.blob())
      a.download = `${batchId}_批次生产总表.xlsx`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (error) { S.toast(error.message, true) }
  }

  function showStation(name, push = true) {
    state.station = stations[name] ? name : 'overview'
    document.body.dataset.station = state.station
    document.querySelectorAll('.work-view').forEach(view => { view.hidden = view.dataset.view !== state.station })
    document.querySelectorAll('.work-tabs button').forEach(button => button.classList.toggle('active', button.dataset.station === state.station))
    el('stationTitle').textContent = stations[state.station]
    if (push) history.replaceState(null, '', `production-scan.html?station=${state.station}`)
    syncSidebarStation()
    const stationAtRender = state.station
    setTimeout(() => { if (state.station === stationAtRender) syncSidebarStation() }, 0)
    refreshStation().catch(error => S.toast(error.message, true))
  }
  function syncSidebarStation() {
    const target = `production-scan.html?station=${state.station}`
    if (typeof window.__adminSidebarSetActive === 'function') {
      window.__adminSidebarSetActive(target)
      return
    }
    document.querySelectorAll('.nav-third-item[href*="production-scan.html?station="]').forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === target)
    })
  }
  async function changeBatch(value) {
    state.batchId = value || ''
    state.pairingSource = null
    state.materialSource = null
    renderPackingEmpty()
    if (state.batchId) sessionStorage.setItem(BATCH_KEY, state.batchId)
    else sessionStorage.removeItem(BATCH_KEY)
    if (!state.batchId) clearBatchViews()
    renderBatchContext()
    await refreshStation()
  }
  function clearBatchViews() {
    state.queue = null
    el('queueCurrent').className = 'queue-current'
    el('queueCurrent').textContent = '请先选择生产批次'
    el('queueList').innerHTML = ''
    el('materialPicks').innerHTML = '<div class="empty">请先选择生产批次</div>'
    el('pairingSources').innerHTML = '<div class="empty">请先选择生产批次</div>'
    el('materialSourceResult').className = 'result'
    el('materialSourceResult').textContent = '等待扫描材料来源。'
    el('materialPickBtn').disabled = true
    el('pairingSourceResult').className = 'result'
    el('pairingSourceResult').textContent = '尚未选择材料来源，请先扫描 KB 或 BX。'
    el('pairingResult').className = 'result'
    el('pairingResult').textContent = '选择材料来源后，可以连续扫描帧素材包。'
    el('waitingList').innerHTML = '<div class="empty">请先选择生产批次</div>'
    renderPackingEmpty()
  }
  async function refreshStation() {
    if (state.station === 'overview') return renderOverview()
    if (!state.batchId) return
    if (state.station === 'frame') return loadFrameQueue()
    if (state.station === 'material') return loadMaterialPicks()
    if (state.station === 'pairing') return loadPairingSources()
    if (state.station === 'packing') return loadWaiting()
  }

  async function loadFrameQueue() {
    const data = await S.request(`/api/admin/production-workflow/frame-print-queue?batchId=${encodeURIComponent(requireBatch())}`)
    state.queue = data
    const list = data.queue || []
    const current = list.find(item => item.frameStatus !== 'COMPLETED')
    el('queueCurrent').className = `queue-current${current ? ' active' : ''}`
    el('queueCurrent').innerHTML = current
      ? `<div><span>当前任务 ${String(current.sequence).padStart(4, '0')}</span><strong>${S.esc(current.productionNo)} · ${S.esc(current.specification)}</strong><small>${S.esc(current.framePackCode || '尚未生成 FP')} · ${current.pageCount || '?'} 页</small></div>${current.downloadUrl ? `<button class="btn btn-black" data-download="${S.esc(current.productionUnitId)}">下载当前 Word</button>` : ''}`
      : '当前批次的帧包任务已经全部完成'
    el('queueList').innerHTML = list.length
      ? list.map(item => `<div class="queue-item ${item.frameStatus === 'COMPLETED' ? 'done' : ''}"><div class="queue-seq">${String(item.sequence).padStart(4, '0')}</div><div><div class="row-title">${S.esc(item.productionNo)} · ${S.esc(item.framePackCode || '尚未生成 FP')}</div><div class="row-meta">${S.esc(item.groupName)} · ${S.esc(item.specification)} · ${item.pageCount || '?'} 页</div></div><span class="badge ${item.frameStatus === 'COMPLETED' ? 'ok' : 'warn'}">${item.frameStatus === 'COMPLETED' ? '已完成' : '待处理'}</span>${item.downloadUrl ? `<button class="btn" data-download="${S.esc(item.productionUnitId)}">下载</button>` : ''}</div>`).join('')
      : '<div class="empty">当前没有打印任务</div>'
    document.querySelectorAll('[data-download]').forEach(button => { button.onclick = () => downloadPrint(button.dataset.download) })
    renderFrameRecent()
  }
  async function downloadPrint(id) {
    const item = state.queue?.queue?.find(row => row.productionUnitId === id)
    if (!item?.downloadUrl) return
    const response = await fetch(item.downloadUrl)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(await response.blob())
    a.download = item.fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  function renderFrameRecent() {
    const list = rows('frame')
    el('frameRecent').innerHTML = list.length
      ? list.map(row => `<div class="row"><div><div class="row-title">${S.esc(row.code)}</div><div class="row-meta">${S.esc(row.specification)} · ${S.formatTime(row.time)}${row.repeats ? ` · 重复扫描 ${row.repeats} 次` : ''}</div></div><span class="badge ${row.repeats ? 'warn' : 'ok'}">${row.repeats ? '未重复登记' : '已完成'}</span></div>`).join('')
      : '<div class="empty">暂无记录</div>'
  }
  async function scanFrame(code) {
    const batchId = requireBatch()
    const normalized = code.trim().toUpperCase()
    if (S.classify(normalized) !== 'FRAME') throw new Error('帧包完成环节只能扫描 FP')
    const info = await S.request(`/api/admin/production-workflow/pairing/lookup/${encodeURIComponent(normalized)}`)
    const data = await S.request(`/api/admin/production-workflow/frame-packs/${encodeURIComponent(normalized)}/complete`, { method: 'POST', body: JSON.stringify({ batchId }) })
    const repeated = data.reused
    setResult(el('frameResult'), repeated ? 'warning' : 'ok', `<span class="code-big">${S.esc(normalized)}</span><br>${S.esc(info.productionNo || '')} · ${S.esc(info.specification || '')}<br>${data.advanced ? `已经进入${S.esc(data.frame.status)}，本次未重复登记` : repeated ? '此前已经完成，本次未重复登记' : '本次登记成功'}`)
    remember('frame', { code: normalized, specification: info.specification || '', time: new Date().toISOString(), repeated })
    renderFrameRecent()
    S.beep(repeated ? 'warn' : true)
    S.toast(repeated ? '此前已经完成，未重复登记' : '帧包已完成')
    await loadFrameQueue()
    await loadOverview()
  }

  async function scanMaterial(code) {
    requireBatch()
    const normalized = code.trim().toUpperCase()
    const type = S.classify(normalized)
    if (!['KIT_BATCH', 'KIT_BOX'].includes(type)) throw new Error('材料领用环节只能扫描 KB 或 BX')
    const info = await S.request(`/api/admin/production-workflow/pairing/lookup/${encodeURIComponent(normalized)}`)
    state.materialSource = { code: normalized, info }
    setResult(el('materialSourceResult'), 'ok', `<span class="code-big">${S.esc(normalized)}</span><br>${S.esc(info.skuCode || 'SKU编码缺失')} · ${S.esc(info.specification || '')}<br>当前可领 ${Number(info.freeQty || 0)} 套`)
    el('materialQuantity').max = Number(info.freeQty || 0)
    el('materialQuantity').value = Math.min(Math.max(1, Number(el('materialQuantity').value) || 1), Number(info.freeQty || 1))
    el('materialPickBtn').disabled = Number(info.freeQty || 0) < 1
    S.beep(true)
  }
  async function confirmMaterialPick() {
    if (!state.materialSource) return
    try {
      await S.request('/api/admin/production-workflow/material-picks', { method: 'POST', body: JSON.stringify({ batchId: requireBatch(), kitCode: state.materialSource.code, quantity: Number(el('materialQuantity').value) }) })
      S.beep(true); S.toast('材料领用成功'); state.materialSource = null
      el('materialSourceResult').className = 'result'; el('materialSourceResult').textContent = '等待扫描下一批材料来源。'; el('materialPickBtn').disabled = true
      await loadMaterialPicks(); await loadOverview()
    } catch (error) { S.beep(false); S.toast(error.message, true) }
  }
  async function loadMaterialPicks() {
    const list = await S.request(`/api/admin/production-workflow/material-picks?batchId=${encodeURIComponent(requireBatch())}`)
    el('materialPicks').innerHTML = list.length
      ? list.map(row => `<div class="row"><div><div class="row-title">${S.esc(row.sourceCode)} · ${row.quantity} 套</div><div class="row-meta">剩余 ${row.remainingQty} · 已配对 ${row.consumedQty} · 已退 ${row.returnedQty}</div></div><span class="badge ${row.remainingQty ? 'warn' : 'ok'}">${row.remainingQty ? '待配对' : row.status}</span></div>`).join('')
      : '<div class="empty">本批次还没有领料记录</div>'
  }

  async function loadPairingSources() {
    const list = await S.request(`/api/admin/production-workflow/material-picks?batchId=${encodeURIComponent(requireBatch())}`)
    const active = list.filter(row => row.status === 'ACTIVE' && row.remainingQty > 0)
    el('pairingSources').innerHTML = active.length
      ? active.map(row => `<div class="source-card"><strong>${S.esc(row.sourceCode)}</strong><span>已领 ${row.quantity} · 已配 ${row.consumedQty} · 剩余 ${row.remainingQty}</span></div>`).join('')
      : '<div class="empty">当前批次没有可配对的已领材料</div>'
    renderPairingRecent()
  }
  async function scanPairing(code) {
    const batchId = requireBatch()
    const normalized = code.trim().toUpperCase()
    const type = S.classify(normalized)
    if (type === 'KIT_BATCH' || type === 'KIT_BOX') {
      if (state.pairingSource?.code === normalized) {
        setResult(el('pairingSourceResult'), 'warning', `<span class="code-big">${S.esc(normalized)}</span><br>当前已经是这个材料来源，无需重复切换`)
        S.beep('warn')
        return
      }
      const info = await S.request(`/api/admin/production-workflow/pairing/material-source/${encodeURIComponent(normalized)}?batchId=${encodeURIComponent(batchId)}`)
      state.pairingSource = { code: normalized, info }
      setResult(el('pairingSourceResult'), 'ok active-source', `<span class="code-big">${S.esc(normalized)}</span><br>${S.esc(info.skuCode)} · ${S.esc(info.specification || '')}<br>已领 ${info.pickedQty} · 已配 ${info.consumedQty} · 剩余 ${info.remainingQty}`)
      el('pairingResult').className = 'result'; el('pairingResult').textContent = '材料来源已锁定，请连续扫描同规格 FP。'
      S.beep(true)
      return
    }
    if (type !== 'FRAME') throw new Error('单件配对环节只能扫描 KB、BX 或 FP')
    if (!state.pairingSource) throw new Error('请先扫描本批次已经领用的 KB 或 BX')
    const info = await S.request(`/api/admin/production-workflow/pairing/lookup/${encodeURIComponent(normalized)}`)
    const data = await S.request('/api/admin/production-workflow/pairing', { method: 'POST', body: JSON.stringify({ batchId, framePackCode: normalized, kitCode: state.pairingSource.code }) })
    setResult(el('pairingResult'), data.reused ? 'warning' : 'ok', `<span class="code-big">${S.esc(normalized)}</span><br>${S.esc(info.productionNo || '')} · ${S.esc(info.specification || '')}<br>${data.reused ? `此前已经与 ${S.esc(data.sourceCode)} 配对，本次未扣库存` : `已与 ${S.esc(state.pairingSource.code)} 配对并消耗一套材料包`}`)
    remember('pairing', { code: normalized, source: state.pairingSource.code, specification: info.specification || '', time: new Date().toISOString(), repeated: data.reused })
    renderPairingRecent(); S.beep(data.reused ? 'warn' : true); await loadPairingSources(); await loadOverview()
  }
  function renderPairingRecent() {
    const list = rows('pairing')
    el('pairingRecent').innerHTML = list.length
      ? list.map(row => `<div class="row"><div><div class="row-title">${S.esc(row.code)}</div><div class="row-meta">${S.esc(row.specification)}<br>${S.esc(row.source)} · ${S.formatTime(row.time)}${row.repeats ? ` · 重复 ${row.repeats} 次` : ''}</div></div><span class="badge ${row.repeats ? 'warn' : 'ok'}">${row.repeats ? '未重复扣减' : '已配对'}</span></div>`).join('')
      : '<div class="empty">暂无记录</div>'
  }

  async function scanPacking(code) {
    requireBatch()
    const normalized = code.trim()
    if (S.classify(normalized) === 'FRAME') {
      if (!state.trackingNo) throw new Error('请先扫描快递面单')
      return scanPackingUnit(normalized.toUpperCase())
    }
    return loadPacking(normalized)
  }
  async function loadPacking(trackingNo) {
    state.trackingNo = trackingNo
    state.packingData = await S.request(`/api/admin/production-workflow/packing/${encodeURIComponent(trackingNo)}?batchId=${encodeURIComponent(requireBatch())}`)
    renderPacking(); await loadWaiting(); S.beep(true)
  }
  function renderPacking() {
    const data = state.packingData
    const done = data.units.filter(row => row.scanned).length
    const paired = data.units.filter(row => row.paired).length
    setResult(el('packingWork'), '', `<span class="code-big">${S.esc(state.trackingNo)}</span><br><strong>${S.esc(data.order.orderNo)} · ${S.esc(data.order.receiverName)}</strong><div class="summary"><div class="sum"><b>${data.units.length}</b><span>应有产品</span></div><div class="sum"><b>${paired}</b><span>已经配对</span></div><div class="sum"><b>${done}</b><span>已经装箱</span></div><div class="sum"><b>${data.units.length - done}</b><span>仍缺</span></div></div>${data.units.map(unit => `<div class="unit ${unit.scanned ? 'done' : unit.paired ? '' : 'blocked'}"><div><div class="unit-no">${S.esc(unit.productionNo)}</div><div class="unit-spec">${S.esc(unit.specification)}</div></div><span class="badge">${unit.scanned ? '已装箱' : unit.paired ? '等待扫描' : '尚未配对'}</span></div>`).join('')}<div class="actions"><button class="btn btn-black" id="shipOrder" ${data.complete ? '' : 'disabled'}>确认交付快递并发货</button><button class="btn" id="clearBox">结束当前箱</button></div>`)
    el('shipOrder').onclick = shipOrder; el('clearBox').onclick = renderPackingEmpty
  }
  function renderPackingEmpty() {
    state.trackingNo = ''; state.packingData = null
    if (el('packingWork')) { el('packingWork').className = 'result'; el('packingWork').textContent = '等待扫描快递面单。' }
  }
  async function scanPackingUnit(code) {
    const data = await S.request(`/api/admin/production-workflow/packing/${encodeURIComponent(state.trackingNo)}/scan`, { method: 'POST', body: JSON.stringify({ batchId: requireBatch(), framePackCode: code }) })
    S.beep(true); S.toast(data.complete ? '整单已经配齐' : '本件已装箱'); await loadPacking(state.trackingNo); await loadOverview()
  }
  async function shipOrder() {
    if (!confirm('确认箱内产品已经核对并交付快递？')) return
    try { const data = await S.request(`/api/admin/production-workflow/packing/${encodeURIComponent(state.trackingNo)}/ship`, { method: 'POST' }); S.beep(true); S.toast(`${data.orderNo} 已发货`); renderPackingEmpty(); await loadOverview(); await loadWaiting() } catch (error) { S.toast(error.message, true) }
  }
  async function loadWaiting() {
    const list = await S.request(`/api/admin/production-workflow/packing-sessions?batchId=${encodeURIComponent(requireBatch())}`)
    el('waitingList').innerHTML = list.length
      ? list.map(row => `<div class="row"><div><div class="row-title">${S.esc(row.orderNo)} · ${S.esc(row.receiverName)}</div><div class="row-meta">${S.esc(row.trackingNo)} · 已装箱 ${row.scanned}/${row.total}</div></div><button class="btn" data-tracking="${S.esc(row.trackingNo)}">继续</button></div>`).join('')
      : '<div class="empty">当前批次没有等待齐套的订单</div>'
    document.querySelectorAll('[data-tracking]').forEach(button => { button.onclick = () => loadPacking(button.dataset.tracking).catch(error => S.toast(error.message, true)) })
  }

  async function dispatchScan(code) {
    if (state.station === 'frame') return scanFrame(code)
    if (state.station === 'material') return scanMaterial(code)
    if (state.station === 'pairing') return scanPairing(code)
    if (state.station === 'packing') return scanPacking(code)
    throw new Error('请先进入一个具体扫码环节')
  }
  function bindManual(inputId, buttonId) {
    const input = el(inputId)
    const run = () => { const value = input.value.trim(); if (!value) return; dispatchScan(value).catch(error => { S.toast(error.message, true); S.beep(false) }); input.value = '' }
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); run() } })
    el(buttonId).onclick = run
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!await S.ensureStaff()) return
    document.querySelectorAll('.work-tabs button').forEach(button => { button.onclick = () => showStation(button.dataset.station) })
    el('globalBatch').onchange = event => changeBatch(event.target.value).catch(error => S.toast(error.message, true))
    el('refreshQueue').onclick = () => loadFrameQueue().catch(error => S.toast(error.message, true))
    el('materialPickBtn').onclick = confirmMaterialPick
    bindManual('frameManual', 'frameManualBtn')
    bindManual('materialManual', 'materialManualBtn')
    bindManual('pairingManual', 'pairingManualBtn')
    bindManual('packingManual', 'packingManualBtn')
    S.installScanner(dispatchScan)
    document.addEventListener('click', event => {
      const link = event.target.closest('a[href*="production-scan.html?station="]')
      if (!link) return
      event.preventDefault()
      showStation(new URL(link.href, location.href).searchParams.get('station'))
    })
    await loadOverview()
    showStation(state.station, false)
  })
})()
