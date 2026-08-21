(function () {
  'use strict'
  const apiBase = location.hostname === '127.0.0.1' ? 'http://127.0.0.1:3001' : 'http://localhost:3001'
  let accessToken = localStorage.getItem('mowo_token') || ''
  let currentStaff = null
  const labels = {
    SUBMITTED: '等待处理', REVIEWING: '正在处理', NEEDS_SUPPLEMENT: '需要补充素材',
    OPTIONS_READY: '待用户确认筛帧', FRAME_ACCEPTED: '用户已确认筛帧', STYLE_SELECTED: '用户已选择款式',
    UNAVAILABLE: '暂时无法制作', CONFIRMED: '已确认', CLOSED: '已关闭'
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char])
  }
  function time(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12:false }) : '—' }
  function canEdit() { return ['OWNER', 'PRODUCTION'].includes(currentStaff?.staffRole) }

  async function request(path, options = {}) {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type':'application/json' } : {}), Authorization:`Bearer ${accessToken}`, ...(options.headers || {}) }
    })
    const result = await response.json()
    if (!response.ok || !result.success) throw new Error(result.message || '操作失败')
    return result.data
  }

  async function enhancedLoadStats() {
    try {
      const stats = await request('/api/admin/customization-requests/stats')
      document.getElementById('mSubmitted').textContent = stats.SUBMITTED || 0
      document.getElementById('mReviewing').textContent = stats.REVIEWING || 0
      document.getElementById('mAction').textContent = (stats.NEEDS_SUPPLEMENT || 0) + (stats.OPTIONS_READY || 0) + (stats.FRAME_ACCEPTED || 0) + (stats.STYLE_SELECTED || 0)
      document.getElementById('mDone').textContent = (stats.UNAVAILABLE || 0) + (stats.CONFIRMED || 0) + (stats.CLOSED || 0)
    } catch {}
  }

  async function enhancedLoadList() {
    const query = new URLSearchParams({ limit:'50' })
    const status = document.getElementById('status').value
    const mode = document.getElementById('mode').value
    const keyword = document.getElementById('keyword').value.trim()
    if (status) query.set('status', status)
    if (mode) query.set('mode', mode)
    if (keyword) query.set('keyword', keyword)
    try {
      const data = await request(`/api/admin/customization-requests?${query}`)
      document.getElementById('rows').innerHTML = data.items.length ? data.items.map(item => {
        const editable = canEdit() && item.mode === 'HUMAN' && ['SUBMITTED', 'REVIEWING'].includes(item.status)
        const editLabel = item.status === 'REVIEWING' ? '继续筛帧' : '开始筛帧'
        return `<div class="row"><div><div class="number">${escapeHtml(item.requestNo)}</div><div class="sub">${escapeHtml(item.user.nickname)} · 手机尾号 ${escapeHtml(item.user.phoneTail || '—')}</div>${item.assignedStaffName ? `<div class="assignee">处理人：${escapeHtml(item.assignedStaffName)}</div>` : ''}</div><div><span class="badge mode-${item.mode.toLowerCase()}">${item.mode === 'HUMAN' ? '人工筛选' : '自己筛选'}</span></div><div><span class="badge s-${item.status}">${escapeHtml(labels[item.status] || item.status)}</span></div><div><div class="number">${escapeHtml(item.modelName)}</div><div class="sub">第 ${item.version} 版</div></div><div class="sub">${time(item.submittedAt)}</div><div class="actions"><button class="view" onclick="openDetail('${item.id}')">查看</button>${editable ? `<button class="view primary" onclick="startFrameTask('${item.id}')">${editLabel}</button>` : ''}</div></div>`
      }).join('') : '<div class="empty">没有符合条件的定制申请</div>'
    } catch (error) {
      document.getElementById('rows').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`
    }
  }

  async function enhancedLoadAll() { await Promise.all([enhancedLoadStats(), enhancedLoadList()]) }

  async function startFrameTask(id) {
    try {
      await request(`/api/admin/customization-requests/${encodeURIComponent(id)}/claim`, { method:'POST' })
      location.href = `customize-editor.html?adminRequestId=${encodeURIComponent(id)}`
    } catch (error) { alert(error.message) }
  }

  async function claimNextTask() {
    try {
      const next = await request('/api/admin/customization-requests/claim-next', { method:'POST' })
      if (!next?.id) return alert('当前没有等待处理的人工筛选任务')
      location.href = `customize-editor.html?adminRequestId=${encodeURIComponent(next.id)}`
    } catch (error) { alert(error.message) }
  }

  window.loadList = enhancedLoadList
  window.loadAll = enhancedLoadAll
  window.loadStats = enhancedLoadStats
  window.startFrameTask = startFrameTask
  window.claimNextTask = claimNextTask

  document.addEventListener('DOMContentLoaded', async () => {
    accessToken = localStorage.getItem('mowo_token') || ''
    currentStaff = await window.fetchCurrentUser?.()
    if (canEdit() && !document.getElementById('claimNextTask')) {
      const button = document.createElement('button')
      button.id = 'claimNextTask'
      button.className = 'btn dark'
      button.textContent = '领取下一条人工筛帧'
      button.onclick = claimNextTask
      document.querySelector('.toolbar').appendChild(button)
    }
    await enhancedLoadAll()
  })
})()
