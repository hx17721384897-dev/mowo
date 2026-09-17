<script setup lang="ts">
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AddressBook from '@/features/address/AddressBook.vue'
import { logoutAllDevices, logoutCurrentDevice } from '@/features/account/api'
import { uploadAvatar } from '@/features/account/avatar-api'
import {
  applyDeactivation,
  cancelDeactivation,
  changePhone,
  checkDeactivation,
  checkNickname,
  getPasswordStatus,
  sendCurrentPhoneCode,
  sendDeactivationCode,
  sendNewPhoneCode,
  updatePassword,
  updateProfile,
  verifyCurrentPhone,
  type PasswordStatus
} from '@/features/account/settings-api'
import { ApiError } from '@/services/api-client'
import { useSessionStore } from '@/stores/session'

type Section = 'profile' | 'security' | 'addresses' | 'account'
type Tone = 'success' | 'error' | 'neutral'

const router = useRouter()
const session = useSessionStore()
const user = computed(() => session.user)
const section = ref<Section>('profile')
const mobileDetail = ref(false)
const profile = reactive({ nickname: '', bio: '', gender: 0 as 0 | 1 | 2, birthday: '' })
const originalNickname = ref('')
const profileDirty = ref(false)
const nicknameState = ref<'idle' | 'checking' | 'available' | 'taken'>('idle')
const nicknameError = ref('')
const savingProfile = ref(false)
const passwordStatus = ref<PasswordStatus>({ hasPassword: false, passwordLoginEnabled: false })
const genderOptions = [
  { value: 0 as const, label: '保密' },
  { value: 1 as const, label: '男' },
  { value: 2 as const, label: '女' }
]
const toast = reactive({ visible: false, message: '', tone: 'neutral' as Tone })
let toastTimer = 0

const phoneOpen = ref(false)
const phoneStep = ref<1 | 2>(1)
const oldOtp = ref('')
const newPhone = ref('')
const newOtp = ref('')
const phoneError = ref('')
const phoneActionToken = ref('')
const phoneBusy = ref(false)

const passwordOpen = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordError = ref('')
const passwordBusy = ref(false)

const deactivationStep = ref<0 | 1 | 2 | 3>(0)
const deactivationAgreed = ref(false)
const deactivationIssues = ref<string[]>([])
const deactivationOtp = ref('')
const deactivationError = ref('')
const deactivationBusy = ref(false)

const confirmState = reactive({
  open: false,
  title: '',
  body: '',
  action: '确认',
  resolve: null as ((confirmed: boolean) => void) | null
})

const avatarInput = ref<HTMLInputElement | null>(null)
const cropImage = ref<HTMLImageElement | null>(null)
const cropOpen = ref(false)
const avatarUploading = ref(false)
let cropper: Cropper | null = null
let avatarBlobUrl = ''

const deletion = computed(() => user.value?.deletionRequest)
const nicknameLockedDays = computed(() => {
  const updated = user.value?.profile?.nicknameUpdatedAt
  if (!updated) return 0
  return Math.max(0, Math.ceil(30 - (Date.now() - new Date(updated).getTime()) / 86_400_000))
})

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError || cause instanceof Error ? cause.message : fallback
}

function showToast(message: string, tone: Tone = 'neutral'): void {
  window.clearTimeout(toastTimer)
  Object.assign(toast, { visible: true, message, tone })
  toastTimer = window.setTimeout(() => (toast.visible = false), 3000)
}

function hydrateProfile(): void {
  const current = user.value?.profile
  profile.nickname = current?.nickname ?? ''
  profile.bio = current?.bio ?? ''
  profile.gender = current?.gender === 1 || current?.gender === 2 ? current.gender : 0
  profile.birthday = current?.birthday?.slice(0, 10) ?? ''
  originalNickname.value = profile.nickname
  profileDirty.value = false
}

function markDirty(): void {
  profileDirty.value = true
}

async function chooseSection(next: Section): Promise<void> {
  if (profileDirty.value && section.value === 'profile') {
    const leave = await ask('有未保存的修改', '您有未保存的修改，确认离开当前页面？', '放弃修改')
    if (!leave) return
    hydrateProfile()
  }
  section.value = next
  history.replaceState(null, '', `${location.pathname}#${next}`)
  if (window.innerWidth <= 767) mobileDetail.value = true
  window.scrollTo({ top: 0, behavior: 'instant' })
}

async function backMobile(): Promise<void> {
  if (profileDirty.value && section.value === 'profile') {
    const leave = await ask('有未保存的修改', '您有未保存的修改，确认离开当前页面？', '放弃修改')
    if (!leave) return
    hydrateProfile()
  }
  mobileDetail.value = false
  history.replaceState(null, '', location.pathname)
}

async function verifyNickname(): Promise<void> {
  const value = profile.nickname.trim()
  nicknameError.value = ''
  if (value.length < 2 || value.length > 20) {
    nicknameError.value = '昵称需在 2～20 个字符之间'
    nicknameState.value = 'taken'
    return
  }
  if (value === originalNickname.value) {
    nicknameState.value = 'idle'
    return
  }
  nicknameState.value = 'checking'
  try {
    const available = await checkNickname(value)
    nicknameState.value = available ? 'available' : 'taken'
    if (!available) nicknameError.value = '该昵称已被使用，请换一个'
  } catch {
    nicknameState.value = 'idle'
  }
}

async function saveProfile(): Promise<void> {
  await verifyNickname()
  if (nicknameError.value || nicknameState.value === 'taken') return
  savingProfile.value = true
  try {
    const updated = await updateProfile({
      nickname: profile.nickname.trim(),
      bio: profile.bio,
      gender: profile.gender,
      birthday: profile.birthday || null
    })
    if (user.value)
      session.updateUser({ ...user.value, profile: { ...user.value.profile, ...updated } })
    originalNickname.value = profile.nickname.trim()
    profileDirty.value = false
    showToast('保存成功', 'success')
  } catch (cause) {
    showToast(messageOf(cause, '保存失败，请稍后重试'), 'error')
  } finally {
    savingProfile.value = false
  }
}

async function selectAvatar(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 5 * 1024 * 1024) return showToast('图片大小不能超过 5MB', 'error')
  if (!['image/jpeg', 'image/png'].includes(file.type))
    return showToast('请选择 JPG 或 PNG 格式', 'error')
  if (avatarBlobUrl) URL.revokeObjectURL(avatarBlobUrl)
  avatarBlobUrl = URL.createObjectURL(file)
  cropOpen.value = true
  await nextTick()
  if (!cropImage.value) return
  cropper?.destroy()
  cropper = new Cropper(cropImage.value, {
    aspectRatio: 1,
    viewMode: 1,
    autoCropArea: 0.8,
    movable: true,
    zoomable: true,
    rotatable: false,
    scalable: false
  })
}

function closeCrop(force = false): void {
  if (avatarUploading.value && !force) return
  cropper?.destroy()
  cropper = null
  cropOpen.value = false
}

async function confirmCrop(): Promise<void> {
  if (!cropper || avatarUploading.value) return
  avatarUploading.value = true
  try {
    const canvas = cropper.getCroppedCanvas({
      width: 400,
      height: 400,
      imageSmoothingQuality: 'high'
    })
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('头像裁剪失败'))),
        'image/jpeg',
        0.9
      )
    )
    const avatarUrl = await uploadAvatar(blob)
    if (user.value) {
      session.updateUser({
        ...user.value,
        profile: { ...user.value.profile, avatarUrl }
      })
    }
    closeCrop(true)
    showToast('头像已更新', 'success')
  } catch (cause) {
    showToast(messageOf(cause, '头像上传失败，请重试'), 'error')
  } finally {
    avatarUploading.value = false
  }
}

function openPhone(): void {
  phoneStep.value = 1
  oldOtp.value = ''
  newPhone.value = ''
  newOtp.value = ''
  phoneActionToken.value = ''
  phoneError.value = ''
  phoneOpen.value = true
}

async function phoneAction(
  action: 'send-old' | 'verify-old' | 'send-new' | 'change'
): Promise<void> {
  if (phoneBusy.value) return
  phoneError.value = ''
  if (action === 'verify-old' && !/^\d{6}$/.test(oldOtp.value))
    return void (phoneError.value = '请输入6位验证码')
  if ((action === 'send-new' || action === 'change') && !/^1[3-9]\d{9}$/.test(newPhone.value)) {
    return void (phoneError.value = '手机号格式不正确')
  }
  if (action === 'change' && !/^\d{6}$/.test(newOtp.value))
    return void (phoneError.value = '请输入6位验证码')
  phoneBusy.value = true
  try {
    if (action === 'send-old') await sendCurrentPhoneCode()
    if (action === 'verify-old') {
      phoneActionToken.value = await verifyCurrentPhone(oldOtp.value)
      phoneStep.value = 2
    }
    if (action === 'send-new') await sendNewPhoneCode(newPhone.value)
    if (action === 'change') {
      await changePhone({
        newPhone: newPhone.value,
        newOtp: newOtp.value,
        actionToken: phoneActionToken.value
      })
      phoneOpen.value = false
      session.reset()
      showToast('手机号换绑成功，请使用新手机号重新登录', 'success')
      window.setTimeout(() => router.replace('/'), 900)
      return
    }
    if (action.startsWith('send')) showToast('验证码已发送')
  } catch (cause) {
    phoneError.value = messageOf(cause, '操作失败')
  } finally {
    phoneBusy.value = false
  }
}

function openPassword(): void {
  currentPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
  passwordError.value = ''
  passwordOpen.value = true
}

async function savePassword(): Promise<void> {
  passwordError.value = ''
  if (newPassword.value.length < 8 || newPassword.value.length > 20)
    return void (passwordError.value = '密码需在 8～20 位之间')
  if (!/[a-zA-Z]/.test(newPassword.value) || !/\d/.test(newPassword.value))
    return void (passwordError.value = '密码必须同时包含字母和数字')
  if (newPassword.value !== confirmPassword.value)
    return void (passwordError.value = '两次输入的密码不一致')
  passwordBusy.value = true
  try {
    await updatePassword({
      ...(currentPassword.value ? { currentPassword: currentPassword.value } : {}),
      newPassword: newPassword.value
    })
    passwordStatus.value = await getPasswordStatus()
    passwordOpen.value = false
    showToast(
      passwordStatus.value.hasPassword ? '密码设置成功，其他设备已退出登录' : '密码设置成功',
      'success'
    )
  } catch (cause) {
    passwordError.value = messageOf(cause, '操作失败')
  } finally {
    passwordBusy.value = false
  }
}

async function logout(all: boolean): Promise<void> {
  const confirmed = await ask(
    all ? '退出全部设备' : '退出当前设备',
    all
      ? '确认让手机、电脑和其他浏览器全部退出吗？之后每台设备都需要重新登录。'
      : '只退出当前浏览器，其他设备仍可继续使用。确认退出吗？'
  )
  if (!confirmed) return
  try {
    await (all ? logoutAllDevices() : logoutCurrentDevice())
  } catch {
    // 本设备仍必须清除不可验证的本地会话。
  }
  session.reset()
  await router.replace('/')
}

async function startDeactivation(): Promise<void> {
  try {
    const result = await checkDeactivation()
    deactivationIssues.value = result.issues
    deactivationAgreed.value = false
    deactivationStep.value = 1
  } catch (cause) {
    showToast(messageOf(cause, '注销条件检查失败，请稍后重试'), 'error')
  }
}

async function submitDeactivation(): Promise<void> {
  if (!/^\d{6}$/.test(deactivationOtp.value))
    return void (deactivationError.value = '请输入6位验证码')
  deactivationBusy.value = true
  try {
    const result = await applyDeactivation(deactivationOtp.value)
    if (user.value) {
      session.user = {
        ...user.value,
        status: 'PENDING_DELETE',
        deletionRequest: {
          status: 'REQUESTED',
          scheduledAt: result.scheduledAt,
          protectionMinutesLeft: result.graceMinutes,
          canCancel: true
        }
      }
    }
    deactivationStep.value = 3
    session.reset()
  } catch (cause) {
    deactivationError.value = messageOf(cause, '验证失败')
  } finally {
    deactivationBusy.value = false
  }
}

async function cancelPendingDeletion(): Promise<void> {
  if (!(await ask('撤销注销', '确认撤销注销申请？账号将恢复正常。'))) return
  try {
    await cancelDeactivation()
    await session.bootstrap(true)
    showToast('已撤销注销申请，账号恢复正常', 'success')
  } catch {
    sessionStorage.setItem('mowo_cancel_deletion_after_login', '1')
    await router.replace({
      name: 'home',
      query: { auth: '1', redirect: '/account/settings#account' }
    })
  }
}

function ask(title: string, body: string, action = '确认'): Promise<boolean> {
  Object.assign(confirmState, { open: true, title, body, action })
  return new Promise((resolve) => (confirmState.resolve = resolve))
}

function resolveConfirm(value: boolean): void {
  confirmState.open = false
  confirmState.resolve?.(value)
  confirmState.resolve = null
}

function beforeUnload(event: BeforeUnloadEvent): void {
  if (!profileDirty.value) return
  event.preventDefault()
}

onMounted(async () => {
  hydrateProfile()
  const hash = location.hash.slice(1) as Section
  if (['profile', 'security', 'addresses', 'account'].includes(hash)) section.value = hash
  if (window.innerWidth <= 767 && location.hash) mobileDetail.value = true
  window.addEventListener('beforeunload', beforeUnload)
  if (sessionStorage.getItem('mowo_cancel_deletion_after_login') === '1') {
    sessionStorage.removeItem('mowo_cancel_deletion_after_login')
    try {
      await cancelDeactivation()
      await session.bootstrap(true)
      hydrateProfile()
      showToast('已撤销注销申请，账号恢复正常', 'success')
    } catch (cause) {
      showToast(messageOf(cause, '撤销注销失败'), 'error')
    }
  }
  try {
    passwordStatus.value = await getPasswordStatus()
  } catch {
    // 密码能力是非关键数据；服务端关闭时保持隐藏。
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  window.clearTimeout(toastTimer)
  cropper?.destroy()
  if (avatarBlobUrl) URL.revokeObjectURL(avatarBlobUrl)
})
</script>

<template>
  <!-- eslint-disable vue/html-indent, vue/html-closing-bracket-newline, vue/multiline-html-element-content-newline -->
  <div class="settings-wrap">
    <h1 class="settings-title">账号设置</h1>

    <div v-if="deletion" class="deactivate-banner">
      <div class="deactivate-banner-text">
        {{
          deletion.status === 'PAUSED'
            ? `注销处理已暂停：${deletion.pauseUserMessage || '请稍后查看处理状态'}`
            : deletion.canCancel
              ? `注销申请已提交，约 ${deletion.protectionMinutesLeft ?? 0} 分钟内可撤销，之后系统将自动清理资料`
              : '资料清理已经开始，为避免数据不一致，此时不能撤销'
        }}
      </div>
      <button
        v-if="deletion.canCancel"
        class="btn-cancel-deactivate"
        @click="cancelPendingDeletion"
      >
        撤销注销
      </button>
    </div>

    <div class="settings-layout" :class="{ 'mobile-detail': mobileDetail }">
      <nav class="settings-sidebar" aria-label="账号设置分类">
        <button
          v-for="item in [
            ['profile', '👤', '基本信息'],
            ['security', '🔒', '账号安全'],
            ['addresses', '📍', '收货地址'],
            ['account', '⚠️', '账号注销']
          ] as const"
          :key="item[0]"
          class="sidebar-item"
          :class="{ active: section === item[0], danger: item[0] === 'account' }"
          @click="chooseSection(item[0])"
        >
          <span class="sidebar-icon">{{ item[1] }}</span
          >{{ item[2] }}
        </button>
      </nav>

      <div class="settings-content">
        <button class="mobile-back-bar" @click="backMobile">‹ 返回设置</button>

        <section v-show="section === 'profile'" class="settings-section">
          <div class="s-card">
            <h2 class="s-card-title">基本信息</h2>
            <div class="avatar-section">
              <button
                class="avatar-preview"
                type="button"
                aria-label="上传头像"
                @click="avatarInput?.click()"
              >
                <img v-if="user?.profile?.avatarUrl" :src="user.profile.avatarUrl" alt="" />
                <span v-else>{{ (profile.nickname || '?')[0] }}</span
                ><i>📷</i>
              </button>
              <div class="avatar-info">
                <b>头像</b>
                <p>支持 JPG / PNG，大小不超过 5MB</p>
                <button class="btn-action" @click="avatarInput?.click()">上传头像</button>
              </div>
              <input
                ref="avatarInput"
                hidden
                type="file"
                accept="image/jpeg,image/png"
                @change="selectAvatar"
              />
            </div>
            <label class="form-group"
              ><span>昵称</span>
              <div class="input-wrap">
                <input
                  v-model="profile.nickname"
                  class="form-input"
                  maxlength="20"
                  :disabled="nicknameLockedDays > 0"
                  placeholder="2～20个字符"
                  @input="markDirty"
                  @blur="verifyNickname"
                /><i>{{
                  nicknameState === 'checking'
                    ? '⏳'
                    : nicknameState === 'available'
                      ? '✅'
                      : nicknameState === 'taken'
                        ? '❌'
                        : ''
                }}</i>
              </div>
              <small v-if="nicknameError" class="error">{{ nicknameError }}</small
              ><small v-else-if="nicknameLockedDays"
                >昵称将于 {{ nicknameLockedDays }} 天后可再次修改</small
              ></label
            >
            <label class="form-group"
              ><span>个人简介<em>（选填）</em></span
              ><textarea
                v-model="profile.bio"
                class="form-input"
                rows="3"
                maxlength="150"
                placeholder="介绍一下自己，最多150字"
                @input="markDirty"
              ></textarea
              ><small class="counter">{{ profile.bio.length }} / 150</small></label
            >
            <fieldset class="form-group">
              <legend>性别<em>（选填）</em></legend>
              <div class="gender-group">
                <label
                  v-for="option in genderOptions"
                  :key="option.value"
                  :class="{ active: profile.gender === option.value }"
                  ><input
                    v-model="profile.gender"
                    type="radio"
                    :value="option.value"
                    @change="markDirty"
                  />{{ option.label }}</label
                >
              </div>
            </fieldset>
            <label class="form-group"
              ><span>生日<em>（选填）</em></span
              ><input
                v-model="profile.birthday"
                class="form-input"
                type="date"
                @change="markDirty"
              /><small>不可选未来日期，年龄需满13周岁</small></label
            >
            <button
              class="btn-primary"
              :disabled="!profileDirty || savingProfile"
              @click="saveProfile"
            >
              {{ savingProfile ? '保存中...' : '保存修改' }}
            </button>
          </div>
        </section>

        <section v-show="section === 'security'" class="settings-section">
          <div class="s-card">
            <h2 class="s-card-title">账号安全</h2>
            <div class="security-row">
              <div>
                <b>登录手机号</b>
                <p>{{ user?.maskedPhone || '未绑定' }}</p>
              </div>
              <button class="btn-action" @click="openPhone">换绑</button>
            </div>
            <div v-if="passwordStatus.passwordLoginEnabled" class="security-row">
              <div>
                <b>登录密码</b>
                <p>{{ passwordStatus.hasPassword ? '已设置' : '未设置（仅短信登录）' }}</p>
              </div>
              <button class="btn-action" @click="openPassword">
                {{ passwordStatus.hasPassword ? '修改' : '设置' }}
              </button>
            </div>
          </div>
        </section>

        <section v-show="section === 'addresses'" class="settings-section">
          <div class="s-card"><AddressBook mode="manage" @notice="showToast" /></div>
        </section>

        <section v-show="section === 'account'" class="settings-section">
          <div class="s-card">
            <h2 class="s-card-title">登录设备</h2>
            <p class="section-desc">
              退出当前设备不会影响手机或其他浏览器；发现账号异常时可退出全部设备。
            </p>
            <div class="button-row">
              <button class="btn-danger" @click="logout(false)">退出当前设备</button
              ><button class="btn-action" @click="logout(true)">退出全部设备</button>
            </div>
          </div>
          <div class="s-card">
            <h2 class="s-card-title">注销账号</h2>
            <div v-if="user?.staffRole || Number(user?.role) > 0" class="section-desc">
              工作人员账号不能自行注销。请先由负责人完成权限和工作交接，再将账号调整为普通用户。
            </div>
            <template v-else-if="deactivationStep === 0">
              <ul class="notice-list">
                <li>⚠️ 注销后，您的账号将无法恢复，请确认已备份所需数据</li>
                <li>💰 账户余额、优惠券、积分将在注销后清零且不可找回</li>
                <li>📄 您发布的内容将匿名化处理，不会对外展示您的账号信息</li>
                <li>⏰ 申请通过检查后有 10 分钟防误操作保护期，保护期内可以撤销</li>
              </ul>
              <button class="btn-danger" @click="startDeactivation">申请注销账号</button> </template
            ><template v-else-if="deactivationStep === 1">
              <h3>注销须知</h3>
              <ul class="notice-list">
                <li>⚠️ 注销后，您的账号将无法恢复</li>
                <li>🔄 提交后全部设备将退出；资料清理开始前可重新登录撤销申请</li>
              </ul>
              <div v-if="deactivationIssues.length" class="issues">
                <div v-for="issue in deactivationIssues" :key="issue">• {{ issue }}</div>
              </div>
              <label class="agree"
                ><input v-model="deactivationAgreed" type="checkbox" />我已阅读并了解以上内容</label
              >
              <div class="button-row">
                <button class="btn-ghost" @click="deactivationStep = 0">取消</button
                ><button
                  class="btn-danger"
                  :disabled="!deactivationAgreed || deactivationIssues.length > 0"
                  @click="deactivationStep = 2"
                >
                  下一步
                </button>
              </div> </template
            ><template v-else-if="deactivationStep === 2">
              <h3>身份验证</h3>
              <p class="section-desc">向您的手机号 {{ user?.maskedPhone }} 发送验证码</p>
              <div class="otp-row">
                <input
                  v-model="deactivationOtp"
                  class="form-input"
                  maxlength="6"
                  inputmode="numeric"
                  placeholder="6位验证码"
                /><button
                  class="btn-action"
                  :disabled="deactivationBusy"
                  @click="
                    sendDeactivationCode()
                      .then(() => showToast('验证码已发送'))
                      .catch((e) => showToast(messageOf(e, '发送失败'), 'error'))
                  "
                >
                  获取验证码
                </button>
              </div>
              <small v-if="deactivationError" class="error">{{ deactivationError }}</small>
              <div class="button-row">
                <button class="btn-ghost" @click="deactivationStep = 1">上一步</button
                ><button
                  class="btn-danger"
                  :disabled="deactivationBusy"
                  @click="submitDeactivation"
                >
                  提交注销申请
                </button>
              </div> </template
            ><template v-else>
              <div class="cold-box">
                <h3>⏳ 注销申请已提交</h3>
                <p>
                  您的账号已进入最长 48
                  小时注销处理期。全部设备将退出，资料清理开始前可重新登录撤销；清理开始后不可撤销。
                </p>
              </div>
              <button class="btn-ghost" @click="router.replace('/')">退出并返回首页</button>
            </template>
          </div>
        </section>
      </div>
    </div>

    <div v-if="toast.visible" class="toast" :class="toast.tone" role="status">
      {{ toast.message }}
    </div>

    <Teleport to="body">
      <div
        v-if="phoneOpen"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="换绑手机号"
      >
        <div class="modal-box">
          <h2>换绑手机号</h2>
          <template v-if="phoneStep === 1">
            <p class="section-desc">首先验证当前手机号 {{ user?.maskedPhone }}</p>
            <div class="otp-row">
              <input
                v-model="oldOtp"
                class="form-input"
                maxlength="6"
                placeholder="6位验证码"
              /><button class="btn-action" :disabled="phoneBusy" @click="phoneAction('send-old')">
                获取验证码
              </button>
            </div>
            <div class="modal-actions">
              <button class="btn-ghost" @click="phoneOpen = false">取消</button
              ><button class="btn-primary" :disabled="phoneBusy" @click="phoneAction('verify-old')">
                下一步
              </button>
            </div> </template
          ><template v-else>
            <label class="form-group"
              ><span>新手机号</span><input v-model="newPhone" class="form-input" maxlength="11"
            /></label>
            <div class="otp-row">
              <input
                v-model="newOtp"
                class="form-input"
                maxlength="6"
                placeholder="验证码"
              /><button class="btn-action" :disabled="phoneBusy" @click="phoneAction('send-new')">
                获取验证码
              </button>
            </div>
            <div class="modal-actions">
              <button class="btn-ghost" @click="phoneStep = 1">上一步</button
              ><button class="btn-primary" :disabled="phoneBusy" @click="phoneAction('change')">
                确认换绑
              </button>
            </div> </template
          ><small v-if="phoneError" class="error">{{ phoneError }}</small>
        </div>
      </div>

      <div
        v-if="passwordOpen"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="设置密码"
      >
        <div class="modal-box">
          <h2>{{ passwordStatus.hasPassword ? '修改密码' : '设置密码' }}</h2>
          <label v-if="passwordStatus.hasPassword" class="form-group"
            ><span>当前密码</span
            ><input v-model="currentPassword" class="form-input" type="password" /></label
          ><label class="form-group"
            ><span>新密码</span
            ><input
              v-model="newPassword"
              class="form-input"
              type="password"
              placeholder="8～20位，包含字母和数字" /></label
          ><label class="form-group"
            ><span>确认新密码</span
            ><input v-model="confirmPassword" class="form-input" type="password" /></label
          ><small v-if="passwordError" class="error">{{ passwordError }}</small>
          <div class="modal-actions">
            <button class="btn-ghost" @click="passwordOpen = false">取消</button
            ><button class="btn-primary" :disabled="passwordBusy" @click="savePassword">
              保存
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="cropOpen"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="裁剪头像"
      >
        <div class="modal-box crop-box">
          <h2>裁剪头像</h2>
          <div class="crop-area"><img ref="cropImage" :src="avatarBlobUrl" alt="待裁剪头像" /></div>
          <div class="modal-actions">
            <button class="btn-ghost" @click="closeCrop()">取消</button
            ><button class="btn-primary" :disabled="avatarUploading" @click="confirmCrop">
              {{ avatarUploading ? '上传中...' : '确认上传' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="confirmState.open" class="modal-overlay top" role="dialog" aria-modal="true">
        <div class="modal-box confirm-box">
          <h2>{{ confirmState.title }}</h2>
          <p class="section-desc">{{ confirmState.body }}</p>
          <div class="modal-actions">
            <button class="btn-ghost" @click="resolveConfirm(false)">取消</button
            ><button class="btn-danger" @click="resolveConfirm(true)">
              {{ confirmState.action }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped src="@/styles/settings.css"></style>
