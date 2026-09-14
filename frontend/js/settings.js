// js/settings.js — 账号设置页面逻辑

// ─────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────
let currentUser = null
let currentSection = 'profile'
let profileDirty = false
let phoneActionToken = null
let nicknameCheckTimer = null
let nicknameAvailable = true
let originalNickname = ''
let cropper = null
let cropperBlobUrl = null

// ─────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 账号退出属于安全操作，应优先绑定，不受其他页面数据加载失败影响。
  setupLogoutButtons()
  if (!window.Router || !window.Router.requireAuth()) return

  // 手机端默认显示列表，清除 HTML 里写死的 active 状态
  if (window.innerWidth <= 767 && !location.hash) {
    document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'))
    document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'))
  }

  await loadAllData()
  handleHashSection()
  setupAvatarInput()
  setupBioCounter()
  setupDeactivateCheckbox()
})

window.addEventListener('mowoLoginCompleted', async () => {
  if (sessionStorage.getItem('mowo_cancel_deletion_after_login') !== '1') return
  sessionStorage.removeItem('mowo_cancel_deletion_after_login')
  await performCancelDeactivate()
})

async function loadAllData() {
  try {
    const res = await apiFetch('/api/v1/account/me')
    if (!res.success) throw new Error(res.message)
    currentUser = res.data
    renderProfile(currentUser)
    renderSecurity(currentUser)
    renderDeactivateBanner(currentUser)
  } catch (e) {
    showToast('加载失败，请刷新重试', 'error')
  }

  try {
    const [pwRes] = await Promise.all([
      apiFetch('/api/v1/account/password-status')
    ])
    if (pwRes.success)   renderPasswordStatus(pwRes.data)
  } catch (e) {
    // non-critical
  }
}

function handleHashSection() {
  const hash = location.hash.replace('#', '')
  const valid = ['profile', 'security', 'addresses', 'account']
  if (valid.includes(hash)) {
    const btn = document.querySelector(`.sidebar-item[data-section="${hash}"]`)
    if (btn) switchSection(hash, btn, true)
  }
}

// ─────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────
function renderProfile(user) {
  const p = user.profile || {}
  originalNickname = p.nickname || ''

  // Avatar
  if (p.avatarUrl) {
    document.getElementById('avatarImg').src = p.avatarUrl
    document.getElementById('avatarImg').style.display = 'block'
    document.getElementById('avatarInitial').style.display = 'none'
  } else {
    document.getElementById('avatarInitial').textContent = (p.nickname || '?')[0]
  }

  document.getElementById('nicknameInput').value = p.nickname || ''

  // Nickname rate limit
  if (p.nicknameUpdatedAt) {
    const daysSince = (Date.now() - new Date(p.nicknameUpdatedAt).getTime()) / 86400000
    if (daysSince < 30) {
      const daysLeft = Math.ceil(30 - daysSince)
      document.getElementById('nicknameInput').disabled = true
      showFieldHint('nicknameHint', `昵称将于 ${daysLeft} 天后可再次修改`)
    }
  }

  document.getElementById('bioInput').value = p.bio || ''
  updateBioCounter()

  // Gender
  const genderVal = p.gender ?? 0
  const genderMap = { 0: 'genderSecret', 1: 'genderMale', 2: 'genderFemale' }
  const genderEl = document.getElementById(genderMap[genderVal])
  if (genderEl) genderEl.checked = true

  // Birthday
  if (p.birthday) {
    document.getElementById('birthdayInput').value = p.birthday.slice(0, 10)
  }
}

function renderSecurity(user) {
  document.getElementById('securityPhone').textContent = user.maskedPhone || '未绑定'
}

function renderPasswordStatus(data) {
  const row = document.getElementById('passwordSecurityRow')
  if (row) row.style.display = data.passwordLoginEnabled ? '' : 'none'
  if (!data.passwordLoginEnabled) return

  const hasPassword = data.hasPassword
  document.getElementById('passwordStatus').textContent = hasPassword ? '已设置' : '未设置（仅短信登录）'
  document.getElementById('passwordBtn').textContent = hasPassword ? '修改' : '设置'
  document.getElementById('passwordModalTitle').textContent = hasPassword ? '修改密码' : '设置密码'
  document.getElementById('currentPasswordGroup').style.display = hasPassword ? 'block' : 'none'
}

function renderDeactivateBanner(user) {
  if (user.staffRole || Number(user.role) > 0) {
    document.getElementById('deactivateNormal').style.display = 'none'
    document.getElementById('staffDeactivateNotice').style.display = 'block'
  }
  if (user.status === 'PENDING_DELETE' && user.deletionRequest) {
    document.getElementById('deactivateBanner').style.display = 'flex'
    const request = user.deletionRequest
    const canCancel = request.canCancel === true
    const bannerText = document.getElementById('deactivateBannerText')
    if (request.status === 'PAUSED') {
      const publicReason = request.pauseUserMessage || '注销处理因必要事项暂时暂停，请稍后查看处理状态'
      bannerText.textContent = canCancel
        ? `注销处理已暂停：${publicReason}。资料清理尚未开始，您仍可撤销注销。`
        : `注销处理已暂停：${publicReason}。由于资料清理已经开始，暂时不能自行撤销，请联系我们协助处理。`
    } else if (canCancel && request.protectionMinutesLeft > 0) {
      bannerText.innerHTML = `注销申请已提交，约 <span id="deactivateMinutesLeft">${request.protectionMinutesLeft}</span> 分钟内可撤销，之后系统将自动清理资料`
    } else if (canCancel) {
      bannerText.textContent = '资料清理尚未开始，您仍可撤销注销；系统即将开始处理。'
    } else {
      const statusText = {
        FAILED: '资料清理暂未完成，系统正在自动重试；为避免数据不一致，此时不能撤销',
        MANUAL_REVIEW: '资料清理遇到异常，工作人员正在关注；为避免数据不一致，此时不能撤销'
      }
      bannerText.textContent = statusText[request.status] || '资料清理已经开始，为避免数据不一致，此时不能撤销'
    }
    document.getElementById('cancelDeactivateBtn').style.display = canCancel ? '' : 'none'
    document.getElementById('deactivateNormal').style.display = 'none'
    document.getElementById('staffDeactivateNotice').style.display = 'none'
    document.getElementById('deactivateFlow').style.display = 'none'
  }
}

// ─────────────────────────────────────────────────
// SECTION NAVIGATION
// ─────────────────────────────────────────────────
function switchSection(sectionId, btnEl, skipDirtyCheck = false) {
  if (!skipDirtyCheck && profileDirty) {
    showDirtyDialog(() => {
      profileDirty = false
      doSwitchSection(sectionId, btnEl)
    })
    return
  }
  doSwitchSection(sectionId, btnEl)
}

function doSwitchSection(sectionId, btnEl) {
  document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'))
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'))

  document.getElementById('section-' + sectionId)?.classList.add('active')
  if (btnEl) btnEl.classList.add('active')
  currentSection = sectionId
  location.hash = sectionId

  // 手机端：进入详情模式
  if (window.innerWidth <= 767) {
    document.querySelector('.settings-layout').classList.add('mobile-detail')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  if (sectionId === 'addresses') initAddressSection()
}

function goBackMobile() {
  if (profileDirty) {
    showDirtyDialog(() => {
      profileDirty = false
      _doGoBack()
    })
    return
  }
  _doGoBack()
}

function _doGoBack() {
  document.querySelector('.settings-layout').classList.remove('mobile-detail')
  document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'))
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'))
  currentSection = ''
  history.replaceState(null, '', location.pathname)
  window.scrollTo({ top: 0, behavior: 'instant' })
}

// ─────────────────────────────────────────────────
// PROFILE: AVATAR
// ─────────────────────────────────────────────────
function setupAvatarInput() {
  document.getElementById('avatarFileInput').addEventListener('change', e => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { showToast('图片大小不能超过 5MB', 'error'); return }
    if (!['image/jpeg', 'image/png'].includes(file.type)) { showToast('请选择 JPG 或 PNG 格式', 'error'); return }

    if (cropperBlobUrl) URL.revokeObjectURL(cropperBlobUrl)
    cropperBlobUrl = URL.createObjectURL(file)

    const img = document.getElementById('cropperImg')
    img.src = cropperBlobUrl

    openModal('cropperModal')

    if (cropper) { cropper.destroy(); cropper = null }
    img.onload = () => {
      cropper = new Cropper(img, {
        aspectRatio: 1,
        viewMode: 1,
        autoCropArea: 0.8,
        movable: true,
        zoomable: true,
        rotatable: false,
        scalable: false,
      })
    }

    // Reset file input so same file can be selected again
    e.target.value = ''
  })
}

async function confirmCrop() {
  if (!cropper) return
  const btn = document.getElementById('cropConfirmBtn')
  btn.disabled = true
  btn.textContent = '上传中...'

  try {
    // Get cropped canvas → blob
    const canvas = cropper.getCroppedCanvas({ width: 400, height: 400, imageSmoothingQuality: 'high' })
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9))

    // Get presign URL
    const presignRes = await apiFetch('/api/upload/presign-avatar', {
      method: 'POST',
      body: JSON.stringify({ fileType: 'image/jpeg', fileSize: blob.size })
    })
    if (!presignRes.success) throw new Error(presignRes.message)

    const { fileId, uploadUrl, completeUrl } = presignRes.data

    // Upload to OSS
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': 'image/jpeg' }
    })
    if (!uploadRes.ok) throw new Error('OSS 上传失败')
    if (completeUrl) {
      const completeRes = await apiFetch(completeUrl.replace(/^https?:\/\/[^/]+/, ''), { method: 'POST' })
      if (!completeRes.success) throw new Error(completeRes.message || '头像校验失败')
    }

    // Atomically verify ownership and adopt this uploaded file as the account avatar.
    const adoptRes = await apiFetch(`/api/upload/files/${encodeURIComponent(fileId)}/use-as-avatar`, { method: 'POST' })
    if (!adoptRes.success) throw new Error(adoptRes.message)
    const accessUrl = adoptRes.data.avatarUrl

    // Update preview
    document.getElementById('avatarImg').src = accessUrl
    document.getElementById('avatarImg').style.display = 'block'
    document.getElementById('avatarInitial').style.display = 'none'
    closeCropper()
    showToast('头像已更新', 'success')

    // Refresh nav avatar
    const cached = JSON.parse(localStorage.getItem('mowo_user') || '{}')
    cached.profile = cached.profile || {}
    cached.profile.avatarUrl = accessUrl
    localStorage.setItem('mowo_user', JSON.stringify(cached))

  } catch (e) {
    console.error('Avatar update failed:', e)
    showToast(e.message || '头像上传失败，请重试', 'error')
  } finally {
    btn.disabled = false
    btn.textContent = '确认上传'
  }
}

function closeCropper() {
  if (cropper) { cropper.destroy(); cropper = null }
  closeModal('cropperModal')
}

// ─────────────────────────────────────────────────
// PROFILE: NICKNAME CHECK
// ─────────────────────────────────────────────────
function onNicknameInput() {
  markProfileDirty()
  nicknameAvailable = false
  clearIcon('nicknameIcon')
  hideFieldMsg('nicknameError')
  clearTimeout(nicknameCheckTimer)
}

function checkNicknameAvailability() {
  const val = document.getElementById('nicknameInput').value.trim()
  if (val.length < 2 || val.length > 20) {
    showFieldError('nicknameError', '昵称需在 2～20 个字符之间')
    nicknameAvailable = false
    return
  }
  if (val === originalNickname) {
    nicknameAvailable = true
    clearIcon('nicknameIcon')
    return
  }
  // Show loading
  document.getElementById('nicknameIcon').textContent = '⏳'
  clearTimeout(nicknameCheckTimer)
  nicknameCheckTimer = setTimeout(async () => {
    try {
      const res = await apiFetch(`/api/v1/account/nickname-check?nickname=${encodeURIComponent(val)}`)
      if (res.data.available) {
        nicknameAvailable = true
        document.getElementById('nicknameIcon').textContent = '✅'
        hideFieldMsg('nicknameError')
      } else {
        nicknameAvailable = false
        document.getElementById('nicknameIcon').textContent = '❌'
        showFieldError('nicknameError', '该昵称已被使用，请换一个')
      }
    } catch {
      document.getElementById('nicknameIcon').textContent = ''
    }
  }, 100)
}

// ─────────────────────────────────────────────────
// PROFILE: BIO COUNTER
// ─────────────────────────────────────────────────
function setupBioCounter() {
  document.getElementById('bioInput').addEventListener('input', updateBioCounter)
}
function updateBioCounter() {
  const len = document.getElementById('bioInput').value.length
  const el = document.getElementById('bioCount')
  el.textContent = `${len} / 150`
  el.style.display = 'block'
}

// ─────────────────────────────────────────────────
// PROFILE: DIRTY TRACKING + SAVE
// ─────────────────────────────────────────────────
function markProfileDirty() {
  profileDirty = true
  document.getElementById('saveProfileBtn').disabled = false
}

async function saveProfile() {
  const nickname = document.getElementById('nicknameInput').value.trim()
  const bio = document.getElementById('bioInput').value
  const gender = parseInt(document.querySelector('input[name="gender"]:checked')?.value ?? 0)
  const birthday = document.getElementById('birthdayInput').value || null

  // Validate nickname
  if (nickname.length < 2 || nickname.length > 20) {
    showFieldError('nicknameError', '昵称需在 2～20 个字符之间')
    return
  }
  if (!nicknameAvailable && nickname !== originalNickname) {
    showFieldError('nicknameError', '该昵称已被使用，请换一个')
    return
  }

  const btn = document.getElementById('saveProfileBtn')
  btn.disabled = true
  btn.textContent = '保存中...'

  try {
    const body = { nickname, bio, gender, birthday }
    const res = await apiFetch('/api/v1/account/profile', {
      method: 'PUT',
      body: JSON.stringify(body)
    })
    if (!res.success) throw new Error(res.message)

    profileDirty = false
    originalNickname = nickname
    showToast('保存成功', 'success')

    // Update nav cache
    const cached = JSON.parse(localStorage.getItem('mowo_user') || '{}')
    cached.profile = cached.profile || {}
    cached.profile.nickname = nickname
    localStorage.setItem('mowo_user', JSON.stringify(cached))

  } catch (e) {
    showToast(e.message || '保存失败，请稍后重试', 'error')
    btn.disabled = false
  } finally {
    btn.textContent = '保存修改'
    btn.disabled = false
  }
}

// ─────────────────────────────────────────────────
// SECURITY: PHONE CHANGE
// ─────────────────────────────────────────────────
function openPhoneModal() {
  phoneActionToken = null
  goPhoneStep(1)
  clearPhoneModalErrors()
  document.getElementById('phoneStep1MaskedPhone').textContent = currentUser?.maskedPhone || ''
  openModal('phoneModal')
}

function goPhoneStep(step) {
  document.querySelectorAll('#phoneModal .modal-step').forEach(s => s.classList.remove('active'))
  document.getElementById('phoneStep' + step).classList.add('active')
}

function clearPhoneModalErrors() {
  ['oldOtpError', 'newPhoneError', 'newOtpError'].forEach(id => hideFieldMsg(id))
  document.getElementById('oldOtpInput').value = ''
  document.getElementById('newPhoneInput').value = ''
  document.getElementById('newOtpInput').value = ''
}

async function sendOldOtp() {
  const btn = document.getElementById('sendOldOtpBtn')
  btn.disabled = true
  startOtpCooldown(btn)
  try {
    const res = await apiFetch('/api/v1/account/phone/send-old-otp', { method: 'POST' })
    if (!res.success) throw new Error(res.message)
    showToast('验证码已发送')
  } catch (e) {
    showToast(e.message || '发送失败', 'error')
  }
}

async function verifyOldPhone() {
  const code = document.getElementById('oldOtpInput').value.trim()
  if (code.length !== 6) { showFieldError('oldOtpError', '请输入6位验证码'); return }

  try {
    const res = await apiFetch('/api/v1/account/phone/verify-old', {
      method: 'POST',
      body: JSON.stringify({ code })
    })
    if (!res.success) throw new Error(res.message)
    phoneActionToken = res.data.actionToken
    goPhoneStep(2)
  } catch (e) {
    showFieldError('oldOtpError', e.message || '验证失败')
  }
}

async function sendNewOtp() {
  const phone = document.getElementById('newPhoneInput').value.trim()
  if (!/^1[3-9]\d{9}$/.test(phone)) { showFieldError('newPhoneError', '手机号格式不正确'); return }

  const btn = document.getElementById('sendNewOtpBtn')
  btn.disabled = true
  startOtpCooldown(btn)

  try {
    const res = await apiFetch('/api/v1/account/phone/send-new-otp', {
      method: 'POST',
      body: JSON.stringify({ newPhone: phone })
    })
    if (!res.success) throw new Error(res.message)
    showToast('验证码已发送')
  } catch (e) {
    showToast(e.message || '发送失败', 'error')
  }
}

async function submitPhoneChange() {
  const newPhone = document.getElementById('newPhoneInput').value.trim()
  const newOtp = document.getElementById('newOtpInput').value.trim()

  if (!/^1[3-9]\d{9}$/.test(newPhone)) { showFieldError('newPhoneError', '手机号格式不正确'); return }
  if (newOtp.length !== 6) { showFieldError('newOtpError', '请输入6位验证码'); return }
  if (!phoneActionToken) { showToast('操作凭证已过期，请重新验证', 'error'); goPhoneStep(1); return }

  try {
    const res = await apiFetch('/api/v1/account/phone/change', {
      method: 'POST',
      body: JSON.stringify({ newPhone, newOtp, actionToken: phoneActionToken })
    })
    if (!res.success) throw new Error(res.message)
    closeModal('phoneModal')
    showToast('手机号换绑成功，请使用新手机号重新登录', 'success')
    localStorage.removeItem('mowo_token')
    localStorage.removeItem('mowo_user')
    setTimeout(() => { window.location.href = 'index.html' }, 900)
  } catch (e) {
    showFieldError('newOtpError', e.message || '换绑失败')
  }
}

// ─────────────────────────────────────────────────
// SECURITY: PASSWORD
// ─────────────────────────────────────────────────
function openPasswordModal() {
  document.getElementById('currentPasswordInput').value = ''
  document.getElementById('newPasswordInput').value = ''
  document.getElementById('confirmPasswordInput').value = ''
  ;['currentPasswordError', 'newPasswordError', 'confirmPasswordError'].forEach(id => hideFieldMsg(id))
  openModal('passwordModal')
}

async function submitPassword() {
  const currentPw = document.getElementById('currentPasswordInput').value
  const newPw = document.getElementById('newPasswordInput').value
  const confirmPw = document.getElementById('confirmPasswordInput').value

  let valid = true
  if (newPw.length < 8 || newPw.length > 20) {
    showFieldError('newPasswordError', '密码需在 8～20 位之间'); valid = false
  } else if (!/[a-zA-Z]/.test(newPw) || !/\d/.test(newPw)) {
    showFieldError('newPasswordError', '密码必须同时包含字母和数字'); valid = false
  } else {
    hideFieldMsg('newPasswordError')
  }
  if (newPw !== confirmPw) {
    showFieldError('confirmPasswordError', '两次输入的密码不一致'); valid = false
  } else {
    hideFieldMsg('confirmPasswordError')
  }
  if (!valid) return

  try {
    const body = { newPassword: newPw }
    if (currentPw) body.currentPassword = currentPw
    const res = await apiFetch('/api/v1/account/password', {
      method: 'POST',
      body: JSON.stringify(body)
    })
    if (!res.success) throw new Error(res.message)
    closeModal('passwordModal')
    showToast(res.message, 'success')
    // Refresh password status
    const pwRes = await apiFetch('/api/v1/account/password-status')
    if (pwRes.success) renderPasswordStatus(pwRes.data)
  } catch (e) {
    if (e.message?.includes('密码错误')) {
      showFieldError('currentPasswordError', e.message)
    } else {
      showToast(e.message || '操作失败', 'error')
    }
  }
}

// ─────────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────────
async function confirmLogout() {
  const confirmed = await showConfirmDialog('退出当前设备', '只退出当前浏览器，其他设备仍可继续使用。确认退出吗？')
  if (!confirmed) return

  await finishLogout('current')
}

async function confirmLogoutAll() {
  const confirmed = await showConfirmDialog(
    '退出全部设备',
    '确认让手机、电脑和其他浏览器全部退出吗？之后每台设备都需要重新登录。'
  )
  if (!confirmed) return

  await finishLogout('all')
}

async function finishLogout(scope) {
  try {
    if (typeof window.mowoLogout === 'function') {
      await window.mowoLogout(scope)
    } else {
      const endpoint = scope === 'all' ? '/api/v1/auth/logout-all' : '/api/v1/auth/logout'
      await apiFetch(endpoint, { method: 'POST' })
    }
  } catch (e) { /* 当前设备仍应清除本地登录信息 */ }
  localStorage.removeItem('mowo_token')
  localStorage.removeItem('mowo_user')
  window.location.replace('index.html')
}

function setupLogoutButtons() {
  document.getElementById('logoutCurrentBtn')?.addEventListener('click', confirmLogout)
  document.getElementById('logoutAllBtn')?.addEventListener('click', confirmLogoutAll)
}

// ─────────────────────────────────────────────────
// DEACTIVATION
// ─────────────────────────────────────────────────
function setupDeactivateCheckbox() {
  document.getElementById('agreeDeactivate').addEventListener('change', e => {
    document.getElementById('deactivateStep1Btn').disabled = !e.target.checked
  })
}

async function startDeactivate() {
  // Check preconditions first
  try {
    const res = await apiFetch('/api/v1/account/deactivate/check')
    if (!res.success) { showToast(res.message || '检查失败', 'error'); return }

    const { canProceed, issues } = res.data
    const issuesEl = document.getElementById('deactivateCheckIssues')
    if (!canProceed) {
      issuesEl.innerHTML = issues.map(i => `<div>• ${i}</div>`).join('')
      issuesEl.style.display = 'block'
    } else {
      issuesEl.style.display = 'none'
    }
  } catch (e) {
    showToast(e.message || '注销条件检查失败，请稍后重试', 'error')
    return
  }

  document.getElementById('deactivateNormal').style.display = 'none'
  document.getElementById('deactivateFlow').style.display = 'block'
  goDeactivateStep(1)
  document.getElementById('agreeDeactivate').checked = false
  document.getElementById('deactivateStep1Btn').disabled = true
}

function cancelDeactivateFlow() {
  document.getElementById('deactivateFlow').style.display = 'none'
  document.getElementById('deactivateNormal').style.display = 'block'
}

function goDeactivateStep(step) {
  document.querySelectorAll('.deactivate-step').forEach(s => s.classList.remove('active'))
  document.getElementById('deactivateStep' + step).classList.add('active')
}

function goDeactivateStep2() {
  if (!document.getElementById('agreeDeactivate').checked) return
  // Check if issues exist
  const issuesEl = document.getElementById('deactivateCheckIssues')
  if (issuesEl.style.display !== 'none' && issuesEl.innerHTML) {
    showToast('请先处理上述问题后再申请注销', 'error')
    return
  }
  document.getElementById('deactivatePhone').textContent = currentUser?.maskedPhone || ''
  goDeactivateStep(2)
}

async function sendDeactivateOtp() {
  const btn = document.getElementById('sendDeactivateOtpBtn')
  btn.disabled = true
  startOtpCooldown(btn)

  try {
    const res = await apiFetch('/api/v1/account/deactivate/send-otp', { method: 'POST' })
    if (!res.success) throw new Error(res.message)
    showToast('验证码已发送')
  } catch (e) {
    showToast(e.message || '发送失败', 'error')
  }
}

async function submitDeactivate() {
  const otp = document.getElementById('deactivateOtpInput').value.trim()
  if (otp.length !== 6) { showFieldError('deactivateOtpError', '请输入6位验证码'); return }

  try {
    const res = await apiFetch('/api/v1/account/deactivate/apply', {
      method: 'POST',
      body: JSON.stringify({ otp })
    })
    if (!res.success) throw new Error(res.message)
    goDeactivateStep(3)
    // Show banner
    if (currentUser) {
      currentUser.status = 'PENDING_DELETE'
      currentUser.deletionRequest = {
        status: 'REQUESTED',
        scheduledAt: res.data?.scheduledAt,
        protectionMinutesLeft: res.data?.graceMinutes || 10,
        canCancel: true
      }
    }
    document.getElementById('deactivateBanner').style.display = 'flex'
    document.getElementById('deactivateBannerText').innerHTML = `注销申请已提交，约 <span id="deactivateMinutesLeft">${res.data?.graceMinutes || 10}</span> 分钟内可撤销，之后系统将自动清理资料`
    document.getElementById('cancelDeactivateBtn').style.display = ''
    if (typeof window.mowoClearLocalSession === 'function') {
      window.mowoClearLocalSession()
    } else {
      localStorage.removeItem('mowo_token')
      localStorage.removeItem('mowo_user')
    }
  } catch (e) {
    showFieldError('deactivateOtpError', e.message || '验证失败')
  }
}

async function cancelDeactivate() {
  const confirmed = await showConfirmDialog('撤销注销', '确认撤销注销申请？账号将恢复正常。')
  if (!confirmed) return

  if (!localStorage.getItem('mowo_token')) {
    sessionStorage.setItem('mowo_cancel_deletion_after_login', '1')
    showToast('请重新验证手机号，登录成功后将自动撤销注销', 'error')
    window.openAuthModal?.()
    return
  }

  await performCancelDeactivate()
}

async function performCancelDeactivate() {
  try {
    const res = await apiFetch('/api/v1/account/deactivate/cancel', { method: 'POST' })
    if (!res.success && res.code === 'AUTH_REQUIRED') {
      sessionStorage.setItem('mowo_cancel_deletion_after_login', '1')
      showToast('请重新验证手机号，登录成功后将自动撤销注销', 'error')
      window.openAuthModal?.()
      return
    }
    if (!res.success) throw new Error(res.message)
    showToast('已撤销注销申请，账号恢复正常', 'success')
    document.getElementById('deactivateBanner').style.display = 'none'
    document.getElementById('deactivateNormal').style.display = 'block'
    document.getElementById('deactivateFlow').style.display = 'none'
    if (currentUser) {
      currentUser.status = 'ACTIVE'
      currentUser.deactivateDaysLeft = null
      currentUser.deletionRequest = null
    }
  } catch (e) {
    showToast(e.message || '撤销失败', 'error')
  }
}

function finishDeactivate() {
  localStorage.removeItem('mowo_token')
  localStorage.removeItem('mowo_user')
  window.location.href = 'index.html'
}

// ─────────────────────────────────────────────────
// UTILITIES: API FETCH
// ─────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('mowo_token')
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  }
  const hasContentType = Object.keys(headers).some(name => name.toLowerCase() === 'content-type')
  if (options.body !== undefined && !hasContentType) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(MOWO_API_BASE + path, {
    ...options,
    credentials: 'include',
    headers
  })

  if (res.status === 401) {
    localStorage.removeItem('mowo_token')
    localStorage.removeItem('mowo_user')
    return { success: false, message: '请重新登录', code: 'AUTH_REQUIRED' }
  }

  const data = await res.json()
  return data
}

// ─────────────────────────────────────────────────
// UTILITIES: MODAL
// ─────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open')
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open')
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay && overlay.id !== 'confirmDialog' && overlay.id !== 'dirtyDialog') {
      overlay.classList.remove('open')
      if (overlay.id === 'cropperModal') closeCropper()
    }
  })
})

// ─────────────────────────────────────────────────
// UTILITIES: CONFIRM DIALOG
// ─────────────────────────────────────────────────
let confirmResolve = null
function showConfirmDialog(title, body, dangerLabel = '确认') {
  document.getElementById('confirmTitle').textContent = title
  document.getElementById('confirmBody').textContent = body
  document.getElementById('confirmOk').textContent = dangerLabel
  openModal('confirmDialog')
  return new Promise(resolve => { confirmResolve = resolve })
}
document.getElementById('confirmOk').onclick = () => {
  closeModal('confirmDialog')
  if (confirmResolve) { confirmResolve(true); confirmResolve = null }
}
document.getElementById('confirmCancel').onclick = () => {
  closeModal('confirmDialog')
  if (confirmResolve) { confirmResolve(false); confirmResolve = null }
}

// ─────────────────────────────────────────────────
// UTILITIES: DIRTY DIALOG
// ─────────────────────────────────────────────────
let dirtyResolve = null
function showDirtyDialog(onLeave) {
  openModal('dirtyDialog')
  dirtyResolve = onLeave
}
document.getElementById('dirtyStay').onclick = () => closeModal('dirtyDialog')
document.getElementById('dirtyLeave').onclick = () => {
  closeModal('dirtyDialog')
  if (dirtyResolve) { dirtyResolve(); dirtyResolve = null }
}

// ─────────────────────────────────────────────────
// UTILITIES: TOAST
// ─────────────────────────────────────────────────
let toastTimer = null
function showToast(msg, type = '') {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = type ? `show ${type}` : 'show'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.className = type }, 3000)
}

// ─────────────────────────────────────────────────
// UTILITIES: FORM HELPERS
// ─────────────────────────────────────────────────
function showFieldError(id, msg) {
  const el = document.getElementById(id)
  if (el) { el.textContent = msg; el.style.display = 'block' }
}
function showFieldHint(id, msg) {
  const el = document.getElementById(id)
  if (el) { el.textContent = msg; el.style.display = 'block' }
}
function hideFieldMsg(id) {
  const el = document.getElementById(id)
  if (el) el.style.display = 'none'
}
function clearIcon(id) {
  const el = document.getElementById(id)
  if (el) el.textContent = ''
}

// ─────────────────────────────────────────────────
// UTILITIES: OTP COOLDOWN BUTTON
// ─────────────────────────────────────────────────
function startOtpCooldown(btn) {
  let secs = 60
  btn.textContent = `${secs}s`
  const timer = setInterval(() => {
    secs--
    if (secs <= 0) {
      clearInterval(timer)
      btn.disabled = false
      btn.textContent = '重新发送'
    } else {
      btn.textContent = `${secs}s`
    }
  }, 1000)
}

// ─────────────────────────────────────────────────
// ADDRESSES
// ─────────────────────────────────────────────────
let addrList = []
let addrEditingId = null
let addrRegions = null
let addrCascadeInited = false

async function initAddressSection() {
  if (!addrRegions) {
    try {
      const r = await fetch('../assets/regions.json')
      addrRegions = await r.json()
    } catch {
      showToast('地区数据加载失败', 'error')
      return
    }
  }
  if (!addrCascadeInited && window._addrUtils) {
    window._addrUtils.initCascadeSelects({
      provinceEl: document.getElementById('addrFProvince'),
      cityEl:     document.getElementById('addrFCity'),
      districtEl: document.getElementById('addrFDistrict'),
      regions:    addrRegions
    })
    addrCascadeInited = true
  }
  await loadAddresses()
}

async function loadAddresses() {
  const list = document.getElementById('addrList')
  list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray3);font-weight:700;">加载中...</div>'
  try {
    const res = await apiFetch('/api/addresses')
    if (!res.success) throw new Error(res.message)
    addrList = res.data || []
    renderAddresses()
  } catch {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:#E53E3E;font-weight:700;">加载失败，请刷新重试</div>'
  }
}

function renderAddresses() {
  const list = document.getElementById('addrList')
  if (!addrList.length) {
    list.innerHTML = `
      <div class="addr-empty">
        <div class="addr-empty-icon">📍</div>
        <div class="addr-empty-title">还没有收货地址</div>
        <div class="addr-empty-desc">添加常用地址，下次购买更快捷</div>
      </div>`
    return
  }
  list.innerHTML = addrList.map(addr => `
    <div class="address-card ${addr.isDefault ? 'is-default' : ''}">
      <div class="card-main">
        <div class="card-top">
          ${addr.isDefault ? '<span class="tag-default">默认</span>' : ''}
          ${addr.label ? `<span class="tag-label">${escHtml(addr.label)}</span>` : ''}
        </div>
        <div>
          <span class="card-name">${escHtml(addr.name)}</span>
          <span class="card-phone">${addrMaskPhone(addr.phone)}</span>
        </div>
        <div class="card-addr">${escHtml([addr.province, addr.city, addr.district, addr.detail].filter(Boolean).join(' '))}</div>
      </div>
      <div class="card-actions">
        ${!addr.isDefault ? `<button class="btn-action set-default" onclick="addrSetDefault('${addr.id}')">设为默认</button>` : ''}
        <button class="btn-action" onclick="openAddressModal('${addr.id}')">编辑</button>
        <button class="btn-action del" onclick="addrDelete('${addr.id}')">删除</button>
      </div>
    </div>
  `).join('')
}

function openAddressModal(id) {
  addrEditingId = id || null
  document.getElementById('addrModalTitle').textContent = id ? '编辑地址' : '新增地址'
  document.getElementById('addrSmartText').value = ''
  document.getElementById('addrSmartHint').textContent = '粘贴后点击识别，或直接手动填写'
  document.getElementById('addrSmartHint').className = 'smart-hint'

  if (id) {
    const addr = addrList.find(a => a.id === id)
    if (addr) {
      document.getElementById('addrFName').value = addr.name
      document.getElementById('addrFPhone').value = addr.phone
      document.getElementById('addrFDetail').value = addr.detail
      document.querySelectorAll('#addrLabelTags .label-tag').forEach(t => {
        t.classList.toggle('active', t.dataset.label === addr.label)
      })
      if (window._addrUtils) {
        window._addrUtils.fillAddressForm({
          provinceEl: document.getElementById('addrFProvince'),
          cityEl:     document.getElementById('addrFCity'),
          districtEl: document.getElementById('addrFDistrict'),
          detailEl:   null
        }, { province: addr.province, city: addr.city, district: addr.district, detail: '' })
      }
    }
  } else {
    document.getElementById('addrFName').value = ''
    document.getElementById('addrFPhone').value = ''
    document.getElementById('addrFDetail').value = ''
    document.getElementById('addrFProvince').value = ''
    document.getElementById('addrFCity').innerHTML = '<option value="">请选择市/州</option>'
    document.getElementById('addrFCity').disabled = true
    document.getElementById('addrFDistrict').innerHTML = '<option value="">请选择区/县</option>'
    document.getElementById('addrFDistrict').disabled = true
    document.querySelectorAll('#addrLabelTags .label-tag').forEach(t => t.classList.remove('active'))
  }

  openModal('addressModal')
}

function addrDoParse() {
  const text = document.getElementById('addrSmartText').value.trim()
  if (!text) return
  if (!window._addrUtils || !addrRegions) { showToast('地区数据加载中，请稍后再试', 'error'); return }
  const parsed = window._addrUtils.smartParseAddress(text, addrRegions)
  window._addrUtils.fillAddressForm({
    nameEl:     document.getElementById('addrFName'),
    phoneEl:    document.getElementById('addrFPhone'),
    provinceEl: document.getElementById('addrFProvince'),
    cityEl:     document.getElementById('addrFCity'),
    districtEl: document.getElementById('addrFDistrict'),
    detailEl:   document.getElementById('addrFDetail')
  }, parsed)

  const hint = document.getElementById('addrSmartHint')
  if (parsed.confidence === 'high') {
    hint.textContent = '✅ 识别完成，请核对信息'
    hint.className = 'smart-hint ok'
  } else if (parsed.confidence === 'medium') {
    hint.textContent = '⚠️ 部分字段未识别，请手动补全'
    hint.className = 'smart-hint warn'
  } else {
    hint.textContent = '识别内容较少，请手动填写'
    hint.className = 'smart-hint'
  }
}

function addrToggleLabel(el) {
  const isActive = el.classList.contains('active')
  document.querySelectorAll('#addrLabelTags .label-tag').forEach(t => t.classList.remove('active'))
  if (!isActive) el.classList.add('active')
}

async function saveAddress() {
  const name     = document.getElementById('addrFName').value.trim()
  const phone    = document.getElementById('addrFPhone').value.trim()
  const province = document.getElementById('addrFProvince').value
  const city     = document.getElementById('addrFCity').value
  const district = document.getElementById('addrFDistrict').value
  const detail   = document.getElementById('addrFDetail').value.trim()
  const activeTag = document.querySelector('#addrLabelTags .label-tag.active')
  const label = activeTag ? activeTag.dataset.label : null

  if (!name) return showToast('请填写收件人姓名', 'error')
  if (!/^1[3-9]\d{9}$/.test(phone)) return showToast('请填写正确的手机号', 'error')
  if (!province) return showToast('请选择省份', 'error')
  if (!city) return showToast('请选择城市', 'error')
  if (!district) return showToast('请选择区/县', 'error')
  if (!detail || detail.length < 5) return showToast('详细地址不少于5个字符', 'error')

  const body = { name, phone, province, city, district, detail, label }
  const url = addrEditingId ? `/api/addresses/${addrEditingId}` : '/api/addresses'
  const method = addrEditingId ? 'PUT' : 'POST'

  try {
    const res = await apiFetch(url, { method, body: JSON.stringify(body) })
    if (!res.success) return showToast(res.message || '保存失败', 'error')
    closeModal('addressModal')
    showToast(addrEditingId ? '地址已更新' : '地址已添加', 'success')
    await loadAddresses()
  } catch {
    showToast('网络错误，请重试', 'error')
  }
}

async function addrSetDefault(id) {
  try {
    const res = await apiFetch(`/api/addresses/${id}/default`, { method: 'PUT' })
    if (!res.success) return showToast(res.message || '操作失败', 'error')
    showToast('已设为默认地址', 'success')
    await loadAddresses()
  } catch {
    showToast('网络错误', 'error')
  }
}

async function addrDelete(id) {
  const addr = addrList.find(a => a.id === id)
  if (!addr) return
  const label = addr.label ? `「${addr.label}」` : ''
  const confirmed = await showConfirmDialog('删除地址', `确定删除${label}${addr.name}的地址吗？`)
  if (!confirmed) return

  try {
    const res = await apiFetch(`/api/addresses/${id}`, { method: 'DELETE' })
    if (!res.success) return showToast(res.message || '删除失败', 'error')
    showToast('地址已删除', 'success')
    await loadAddresses()
  } catch {
    showToast('网络错误', 'error')
  }
}

function addrMaskPhone(p) {
  return p ? p.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : ''
}

function escHtml(s) {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─────────────────────────────────────────────────
// MOBILE MENU
// ─────────────────────────────────────────────────
function toggleMenu() {
  const burger = document.getElementById('burger')
  const menu = document.getElementById('mobileMenu')
  burger.classList.toggle('open')
  menu.classList.toggle('open')
  document.body.style.overflow = menu.classList.contains('open') ? 'hidden' : ''
}

function closeMenu() {
  document.getElementById('burger')?.classList.remove('open')
  document.getElementById('mobileMenu')?.classList.remove('open')
  document.body.style.overflow = ''
}
