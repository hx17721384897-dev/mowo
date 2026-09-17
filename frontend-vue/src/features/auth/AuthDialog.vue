<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ApiError } from '@/services/api-client'
import { useSessionStore } from '@/stores/session'
import {
  completeRegistrationProfile,
  sendSms,
  verifySms,
  type AuthResult,
  type SmsMode
} from './api'

const props = defineProps<{ open: boolean; intro?: string }>()
const emit = defineEmits<{ close: []; authenticated: [] }>()
const session = useSessionStore()
const closeButton = ref<HTMLButtonElement | null>(null)
const mode = ref<SmsMode>('LOGIN')
const phone = ref('')
const code = ref('')
const agreed = ref(false)
const sending = ref(false)
const verifying = ref(false)
const countdown = ref(0)
const phoneError = ref('')
const codeError = ref('')
const errorAction = ref<'LOGIN' | 'REGISTER' | null>(null)
const profileOpen = ref(false)
const nickname = ref('')
const profileError = ref('')
const savingProfile = ref(false)
const pendingRegistration = ref<AuthResult | null>(null)
let countdownTimer: number | null = null

const validPhone = computed(() => /^1[3-9]\d{9}$/.test(phone.value))
const validCode = computed(() => /^\d{6}$/.test(code.value))
const validNickname = computed(() => {
  const length = nickname.value.trim().length
  return length >= 2 && length <= 20
})
const registerReady = computed(() => validPhone.value && validCode.value && agreed.value)

watch(
  () => props.open,
  async (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      await nextTick()
      closeButton.value?.focus()
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  if (countdownTimer !== null) window.clearInterval(countdownTimer)
})

function clearErrors(): void {
  phoneError.value = ''
  codeError.value = ''
  errorAction.value = null
}

function switchMode(next: SmsMode): void {
  mode.value = next
  code.value = ''
  clearErrors()
}

function switchFromError(): void {
  if (errorAction.value) switchMode(errorAction.value)
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError || cause instanceof Error ? cause.message : fallback
}

function showRequestError(cause: unknown): void {
  if (cause instanceof ApiError && cause.code === 'ACCOUNT_NOT_FOUND') {
    phoneError.value = '该手机号尚未注册。'
    errorAction.value = 'REGISTER'
    return
  }
  if (cause instanceof ApiError && cause.code === 'ACCOUNT_ALREADY_EXISTS') {
    phoneError.value = '该手机号已注册。'
    errorAction.value = 'LOGIN'
    return
  }
  phoneError.value = messageOf(cause, '发送失败，请重试')
}

function startCountdown(): void {
  countdown.value = 60
  if (countdownTimer !== null) window.clearInterval(countdownTimer)
  countdownTimer = window.setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0 && countdownTimer !== null) {
      window.clearInterval(countdownTimer)
      countdownTimer = null
    }
  }, 1000)
}

async function requestCode(): Promise<void> {
  clearErrors()
  if (!validPhone.value) {
    phoneError.value = '请输入正确的手机号'
    return
  }
  if (sending.value || countdown.value > 0) return
  sending.value = true
  try {
    await sendSms(phone.value, mode.value)
    startCountdown()
  } catch (cause) {
    showRequestError(cause)
  } finally {
    sending.value = false
  }
}

function validateSubmit(): boolean {
  clearErrors()
  if (!validPhone.value) phoneError.value = '请输入正确的手机号'
  if (!validCode.value) codeError.value = '验证码不正确'
  if (mode.value === 'REGISTER' && !agreed.value) {
    codeError.value = '请先勾选同意《隐私政策》和《用户协议》'
  }
  return !phoneError.value && !codeError.value
}

async function submit(): Promise<void> {
  if (verifying.value || !validateSubmit()) return
  verifying.value = true
  try {
    const result = await verifySms({
      phone: phone.value,
      code: code.value,
      mode: mode.value,
      agreedToPrivacy: mode.value === 'REGISTER' ? agreed.value : false
    })
    if (mode.value === 'REGISTER') {
      pendingRegistration.value = result
      nickname.value = result.user.profile?.nickname ?? result.user.nickname ?? ''
      profileOpen.value = true
      return
    }
    session.establish(result.accessToken, result.user)
    emit('authenticated')
    emit('close')
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'ACCOUNT_NOT_FOUND') {
      codeError.value = '该手机号尚未注册。'
      errorAction.value = 'REGISTER'
    } else if (cause instanceof ApiError && cause.code === 'ACCOUNT_ALREADY_EXISTS') {
      codeError.value = '该手机号已注册。'
      errorAction.value = 'LOGIN'
    } else {
      codeError.value = messageOf(cause, mode.value === 'LOGIN' ? '登录失败' : '注册失败，请重试')
    }
  } finally {
    verifying.value = false
  }
}

async function submitProfile(): Promise<void> {
  const pending = pendingRegistration.value
  if (!pending || savingProfile.value) return
  if (!validNickname.value) {
    profileError.value = '昵称需在 2～20 个字符之间'
    return
  }
  savingProfile.value = true
  profileError.value = ''
  try {
    const profile = await completeRegistrationProfile(pending.accessToken, nickname.value.trim())
    session.establish(pending.accessToken, {
      ...pending.user,
      nickname: profile.nickname ?? nickname.value.trim(),
      profile: { ...pending.user.profile, ...profile }
    })
    emit('authenticated')
    emit('close')
  } catch (cause) {
    profileError.value = messageOf(cause, '资料保存失败，请稍后重试')
  } finally {
    savingProfile.value = false
  }
}

function close(): void {
  emit('close')
}

function handleEscape(): void {
  close()
}
</script>

<template>
  <div
    v-if="!profileOpen"
    class="auth-overlay open"
    role="dialog"
    aria-modal="true"
    aria-labelledby="mowo-auth-title"
    @keydown.esc="handleEscape"
  >
    <div class="auth-box">
      <div class="auth-box-bar"></div>
      <div class="auth-box-inner">
        <button
          ref="closeButton"
          class="auth-box-close"
          type="button"
          aria-label="关闭登录窗口"
          @click="close"
        >
          ✕
        </button>
        <p id="mowo-auth-title" class="auth-box-logo">哞屋 MOWO</p>
        <p class="auth-box-logo-sub">动态文创 · 创作者平台</p>
        <p v-if="props.intro" class="auth-context-note" role="status">{{ props.intro }}</p>

        <div class="auth-main-tabs" role="tablist" aria-label="登录或注册">
          <button
            class="auth-main-tab"
            :class="{ active: mode === 'LOGIN' }"
            type="button"
            role="tab"
            :aria-selected="mode === 'LOGIN'"
            @click="switchMode('LOGIN')"
          >
            登录
          </button>
          <button
            class="auth-main-tab"
            :class="{ active: mode === 'REGISTER' }"
            type="button"
            role="tab"
            :aria-selected="mode === 'REGISTER'"
            @click="switchMode('REGISTER')"
          >
            注册
          </button>
        </div>

        <form class="auth-panel active" @submit.prevent="submit">
          <div class="login-sub-panel active">
            <div class="auth-field">
              <div class="auth-field-row" :class="{ error: phoneError }">
                <input
                  v-model.trim="phone"
                  class="auth-input"
                  type="tel"
                  inputmode="tel"
                  autocomplete="tel"
                  maxlength="11"
                  placeholder="请输入手机号"
                  aria-label="手机号"
                  @input="phone = phone.replace(/\D/g, '').slice(0, 11)"
                />
              </div>
              <p class="auth-field-err" :class="{ show: phoneError }" role="alert">
                {{ phoneError }}
                <button
                  v-if="errorAction"
                  type="button"
                  class="auth-error-link"
                  @click="switchFromError"
                >
                  {{ errorAction === 'REGISTER' ? '前往注册' : '返回登录' }}
                </button>
              </p>
            </div>
            <div class="auth-field">
              <div class="auth-field-row" :class="{ error: codeError }">
                <input
                  v-model.trim="code"
                  class="auth-input"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="6"
                  placeholder="请输入验证码"
                  aria-label="验证码"
                  @input="code = code.replace(/\D/g, '').slice(0, 6)"
                />
                <button
                  class="auth-input-btn"
                  :class="{ counting: countdown > 0 }"
                  type="button"
                  :disabled="sending || countdown > 0"
                  @click="requestCode"
                >
                  {{ sending ? '发送中...' : countdown > 0 ? `${countdown}s后重发` : '获取验证码' }}
                </button>
              </div>
              <p class="auth-field-err" :class="{ show: codeError }" role="alert">
                {{ codeError }}
                <button
                  v-if="errorAction"
                  type="button"
                  class="auth-error-link"
                  @click="switchFromError"
                >
                  {{ errorAction === 'REGISTER' ? '前往注册' : '返回登录' }}
                </button>
              </p>
            </div>

            <div v-if="mode === 'REGISTER'" class="auth-agree">
              <button
                class="auth-agree-box"
                :class="{ checked: agreed }"
                type="button"
                role="checkbox"
                :aria-checked="agreed"
                aria-label="同意用户协议和隐私政策"
                @click="agreed = !agreed"
              ></button>
              <p class="auth-agree-text">
                我已阅读并同意
                <RouterLink to="/legal/terms" target="_blank" rel="noopener noreferrer">
                  《用户协议》
                </RouterLink>
                和
                <RouterLink to="/legal/privacy" target="_blank" rel="noopener noreferrer">
                  《隐私政策》
                </RouterLink>
              </p>
            </div>

            <button
              class="auth-submit-btn"
              :class="{ loading: verifying }"
              type="submit"
              :disabled="verifying || (mode === 'REGISTER' && !registerReady)"
            >
              {{ verifying ? '' : mode === 'LOGIN' ? '登录' : '注册并登录' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <div
    v-if="profileOpen"
    class="auth-overlay open"
    role="dialog"
    aria-modal="true"
    aria-labelledby="mowo-profile-title"
    @click.self="close"
    @keydown.esc="close"
  >
    <div class="auth-box auth-profile-box">
      <div class="auth-box-bar auth-profile-bar"></div>
      <form class="auth-box-inner" @submit.prevent="submitProfile">
        <h2 id="mowo-profile-title" class="auth-profile-title">欢迎加入<span>哞屋</span> 👋</h2>
        <p class="auth-profile-copy">最后一步，给自己起个昵称吧</p>
        <div class="auth-field">
          <label class="auth-field-label" for="profileNickname">昵称 <span>*</span></label>
          <div class="auth-field-row" :class="{ error: profileError }">
            <input
              id="profileNickname"
              v-model="nickname"
              class="auth-input"
              type="text"
              placeholder="2-20个字符"
              maxlength="20"
              autofocus
            />
            <span class="auth-char-count">{{ nickname.length }}/20</span>
          </div>
          <p class="auth-field-err" :class="{ show: profileError }" role="alert">
            {{ profileError }}
          </p>
        </div>
        <button
          class="auth-submit-btn"
          :class="{ loading: savingProfile }"
          type="submit"
          :disabled="!validNickname || savingProfile"
        >
          {{ savingProfile ? '' : '完成，进入哞屋 →' }}
        </button>
      </form>
    </div>
  </div>
</template>
