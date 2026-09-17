<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ApiError } from '@/services/api-client'
import { useSessionStore } from '@/stores/session'
import { sendSms, verifySms, type SmsMode } from './api'

const props = withDefaults(
  defineProps<{
    open: boolean
    intro?: string
  }>(),
  {
    intro: '登录完成后会返回你刚才访问的位置，不会自动创建订单或付款。'
  }
)
const emit = defineEmits<{ close: []; authenticated: [] }>()
const session = useSessionStore()
const dialog = ref<HTMLDialogElement | null>(null)
const mode = ref<SmsMode>('LOGIN')
const phone = ref('')
const code = ref('')
const agreed = ref(false)
const sending = ref(false)
const verifying = ref(false)
const error = ref('')
const sent = ref(false)

const validPhone = computed(() => /^1[3-9]\d{9}$/.test(phone.value))

watch(
  () => props.open,
  async (open) => {
    await nextTick()
    if (open && !dialog.value?.open) dialog.value?.showModal()
    if (!open && dialog.value?.open) dialog.value.close()
  },
  { immediate: true }
)

function resetMessage(): void {
  error.value = ''
  sent.value = false
  code.value = ''
}

function switchMode(next: SmsMode): void {
  mode.value = next
  resetMessage()
}

function messageOf(cause: unknown): string {
  return cause instanceof ApiError || cause instanceof Error
    ? cause.message
    : '请求失败，请稍后重试'
}

async function requestCode(): Promise<void> {
  if (!validPhone.value || sending.value) return
  error.value = ''
  sending.value = true
  try {
    await sendSms(phone.value, mode.value)
    sent.value = true
  } catch (cause) {
    error.value = messageOf(cause)
  } finally {
    sending.value = false
  }
}

async function submit(): Promise<void> {
  if (!validPhone.value || !/^\d{6}$/.test(code.value) || verifying.value) return
  if (mode.value === 'REGISTER' && !agreed.value) {
    error.value = '注册前请阅读并同意用户协议和隐私政策'
    return
  }
  error.value = ''
  verifying.value = true
  try {
    const result = await verifySms({
      phone: phone.value,
      code: code.value,
      mode: mode.value,
      agreedToPrivacy: agreed.value
    })
    session.establish(result.accessToken, result.user)
    emit('authenticated')
    emit('close')
  } catch (cause) {
    error.value = messageOf(cause)
  } finally {
    verifying.value = false
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="auth-dialog"
    aria-labelledby="auth-title"
    @cancel.prevent="emit('close')"
  >
    <form class="auth-dialog__panel" method="dialog" @submit.prevent="submit">
      <button
        class="auth-dialog__close"
        type="button"
        aria-label="关闭登录窗口"
        @click="emit('close')"
      >
        ×
      </button>
      <p class="section-kicker">ACCOUNT</p>
      <h2 id="auth-title">{{ mode === 'LOGIN' ? '登录后继续' : '注册哞屋账户' }}</h2>
      <p class="auth-dialog__intro">{{ props.intro }}</p>

      <div class="auth-dialog__tabs" role="tablist" aria-label="登录或注册">
        <button type="button" :class="{ active: mode === 'LOGIN' }" @click="switchMode('LOGIN')">
          登录
        </button>
        <button
          type="button"
          :class="{ active: mode === 'REGISTER' }"
          @click="switchMode('REGISTER')"
        >
          注册
        </button>
      </div>

      <label>
        <span>手机号</span>
        <input
          v-model.trim="phone"
          inputmode="tel"
          autocomplete="tel"
          maxlength="11"
          placeholder="中国大陆手机号"
        />
      </label>
      <div class="auth-dialog__code">
        <label>
          <span>短信验证码</span>
          <input
            v-model.trim="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="6 位验证码"
          />
        </label>
        <button type="button" :disabled="!validPhone || sending" @click="requestCode">
          {{ sending ? '发送中…' : sent ? '重新发送' : '获取验证码' }}
        </button>
      </div>
      <p v-if="sent" class="auth-dialog__success" role="status">验证码已发送，请查看短信。</p>

      <label v-if="mode === 'REGISTER'" class="auth-dialog__consent">
        <input v-model="agreed" type="checkbox" />
        <span>
          我已阅读并同意
          <RouterLink to="/legal/terms" target="_blank" rel="noopener noreferrer">
            用户协议
          </RouterLink>
          和
          <RouterLink to="/legal/privacy" target="_blank" rel="noopener noreferrer">
            隐私政策
          </RouterLink>
        </span>
      </label>
      <p v-if="error" class="auth-dialog__error" role="alert">{{ error }}</p>
      <button
        class="primary-action auth-dialog__submit"
        type="submit"
        :disabled="!validPhone || code.length !== 6 || verifying"
      >
        {{ verifying ? '验证中…' : mode === 'LOGIN' ? '登录并继续' : '注册并继续' }}
      </button>
    </form>
  </dialog>
</template>
