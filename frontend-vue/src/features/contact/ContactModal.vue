<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ApiError } from '@/services/api-client'
import { contactUploadSession, submitContact, uploadContactFile } from './api'
import {
  buildContactPayload,
  contactFilePolicy,
  initialContactValues,
  validateContactFiles
} from './definitions'
import type { ContactDefinition, ContactValues } from './types'

const props = defineProps<{ definition: ContactDefinition }>()
const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLElement | null>(null)
const values = ref<ContactValues>(initialContactValues(props.definition))
const error = ref('')
const submitting = ref(false)
const succeeded = ref(false)
const uploadedKeys = new Map<string, string>()
const session = contactUploadSession()
const previousBodyOverflow = document.body.style.overflow

const fields = computed(() => props.definition.rows.flat())

function stringValue(name: string): string {
  const value = values.value[name]
  return typeof value === 'string' ? value : ''
}

function booleanValue(name: string): boolean {
  return values.value[name] === true
}

function filesValue(): File[] {
  const value = values.value.files
  return Array.isArray(value) ? value : []
}

function fileIdentity(file: File): string {
  return `${file.name}:${file.type}:${file.size}:${file.lastModified}`
}

function selectedFileText(): string {
  const files = filesValue()
  return files.length ? `✓ ${files.map((file) => file.name).join('、')}` : ''
}

function updateString(name: string, event: Event): void {
  values.value[name] = (
    event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  ).value
}

function updateBoolean(name: string, event: Event): void {
  values.value[name] = (event.target as HTMLInputElement).checked
}

function updateFiles(event: Event): void {
  const input = event.target as HTMLInputElement
  values.value.files = Array.from(input.files ?? [])
  uploadedKeys.clear()
  error.value = ''
  try {
    validateContactFiles(props.definition.type, filesValue())
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '文件不符合要求'
    input.value = ''
    values.value.files = []
  }
}

function validateRequiredFields(): void {
  for (const field of fields.value) {
    if (!field.required) continue
    if (field.kind === 'file') {
      if (!filesValue().length) throw new Error(`请上传${field.label}`)
      continue
    }
    if (!stringValue(field.name).trim()) {
      throw new Error(`${field.kind === 'select' ? '请选择' : '请填写'}${field.label}`)
    }
  }
  validateContactFiles(props.definition.type, filesValue())
}

async function uploadFiles(): Promise<string[]> {
  const policy = contactFilePolicy(props.definition.type)
  const files = filesValue()
  if (!policy || !files.length) return []
  const keys: string[] = []
  for (const file of files) {
    const identity = fileIdentity(file)
    let key = uploadedKeys.get(identity)
    if (!key) {
      key = await uploadContactFile(file, policy.purpose, session)
      uploadedKeys.set(identity, key)
    }
    keys.push(key)
  }
  return keys
}

async function submit(): Promise<void> {
  if (submitting.value || succeeded.value) return
  error.value = ''
  try {
    validateRequiredFields()
    submitting.value = true
    const attachments = await uploadFiles()
    const payload = buildContactPayload(props.definition.type, values.value, attachments)
    await submitContact(payload, session)
    succeeded.value = true
    await nextTick()
    dialog.value?.querySelector<HTMLElement>('.success-close')?.focus()
  } catch (cause) {
    error.value =
      cause instanceof ApiError || cause instanceof Error ? cause.message : '提交失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}

function close(): void {
  if (!submitting.value) emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
  if (event.key !== 'Tab' || !dialog.value) return
  const focusable = Array.from(
    dialog.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]'
    )
  ).filter((element) => element.offsetParent !== null)
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable.at(-1)!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeydown)
  await nextTick()
  dialog.value?.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
})

onBeforeUnmount(() => {
  document.body.style.overflow = previousBodyOverflow
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="contact-modal-backdrop open" @mousedown.self="close">
    <section
      ref="dialog"
      class="contact-modal"
      :class="`modal-${definition.type}`"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="`contact-modal-title-${definition.type}`"
    >
      <header class="modal-header">
        <div class="modal-header-bg" />
        <button
          class="modal-close"
          type="button"
          :disabled="submitting"
          aria-label="关闭联络表单"
          @click="close"
        >
          ✕
        </button>
        <span class="modal-icon" aria-hidden="true">{{ definition.icon }}</span>
        <h2 :id="`contact-modal-title-${definition.type}`" class="modal-title">
          {{ definition.modalTitle }}
        </h2>
        <p class="modal-subtitle">{{ definition.modalSubtitle }}</p>
      </header>

      <form v-if="!succeeded" class="modal-body" @submit.prevent="submit">
        <p class="modal-desc">{{ definition.description }}</p>

        <div
          v-for="(row, rowIndex) in definition.rows"
          :key="rowIndex"
          :class="{ 'form-row': row.length > 1 }"
        >
          <div v-for="field in row" :key="field.name" class="form-group">
            <template v-if="field.kind === 'checkbox'">
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  :checked="booleanValue(field.name)"
                  @change="updateBoolean(field.name, $event)"
                />
                <span>{{ field.label }}</span>
              </label>
            </template>

            <template v-else-if="field.kind === 'file'">
              <span class="form-label">
                {{ field.label }}<span v-if="field.required" class="form-required">*</span>
              </span>
              <label class="file-upload">
                <input
                  type="file"
                  :accept="field.accept"
                  :multiple="field.multiple"
                  :required="field.required"
                  @change="updateFiles"
                />
                <span class="file-upload-icon" aria-hidden="true">
                  {{ definition.type === 'join' ? '📄' : '🖼️' }}
                </span>
                <span v-if="!selectedFileText()" class="file-upload-text">点击选择文件</span>
                <span v-if="!selectedFileText()" class="file-upload-sub">{{ field.hint }}</span>
                <span v-else class="file-name">{{ selectedFileText() }}</span>
              </label>
            </template>

            <template v-else>
              <label class="form-label" :for="`contact-${definition.type}-${field.name}`">
                {{ field.label }}<span v-if="field.required" class="form-required">*</span>
              </label>
              <textarea
                v-if="field.kind === 'textarea'"
                :id="`contact-${definition.type}-${field.name}`"
                class="form-textarea"
                :name="field.name"
                :required="field.required"
                :placeholder="field.placeholder"
                :maxlength="field.name === 'message' ? 2000 : 500"
                :style="field.minHeight ? { minHeight: `${field.minHeight}px` } : undefined"
                :value="stringValue(field.name)"
                @input="updateString(field.name, $event)"
              />
              <select
                v-else-if="field.kind === 'select'"
                :id="`contact-${definition.type}-${field.name}`"
                class="form-select"
                :name="field.name"
                :required="field.required"
                :value="stringValue(field.name)"
                @change="updateString(field.name, $event)"
              >
                <option value="" disabled>请选择</option>
                <option v-for="option in field.options" :key="option" :value="option">
                  {{ option }}
                </option>
              </select>
              <input
                v-else
                :id="`contact-${definition.type}-${field.name}`"
                class="form-input"
                :name="field.name"
                :type="field.kind"
                :required="field.required"
                :placeholder="field.placeholder"
                :maxlength="field.name === 'name' ? 100 : field.name === 'contact' ? 200 : 500"
                :value="stringValue(field.name)"
                @input="updateString(field.name, $event)"
              />
            </template>
          </div>
        </div>

        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="form-submit" type="submit" :disabled="submitting">
          {{ submitting ? '提交中…' : definition.submitLabel }}
        </button>
        <p class="form-note">
          {{ definition.formNote }}。提交即表示你已阅读<RouterLink
            to="/legal/privacy"
            target="_blank"
            rel="noopener noreferrer"
            >隐私政策</RouterLink
          >。
        </p>
      </form>

      <div v-else class="modal-success">
        <div class="success-icon" aria-hidden="true">{{ definition.successIcon }}</div>
        <h3 class="success-title">{{ definition.successTitle }}</h3>
        <p class="success-body">{{ definition.successBody }}</p>
        <button class="success-close" type="button" @click="close">
          {{ definition.successClose }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.contact-modal-backdrop {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgb(44 31 20 / 50%);
  backdrop-filter: blur(8px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}
.contact-modal-backdrop.open {
  opacity: 1;
  pointer-events: all;
}
.contact-modal {
  position: relative;
  width: 100%;
  max-width: 580px;
  max-height: 90vh;
  overflow-y: auto;
  border-radius: 32px;
  background: #fff;
  color: #2c1f14;
  font-family: Nunito, 'Noto Sans SC', sans-serif;
  scrollbar-width: none;
  transform: translateY(40px) scale(0.96);
  transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
.contact-modal::-webkit-scrollbar {
  display: none;
}
.contact-modal-backdrop.open .contact-modal {
  transform: none;
}
.modal-header {
  position: relative;
  padding: 36px 36px 28px;
  overflow: hidden;
  border-radius: 30px 30px 0 0;
}
.modal-header-bg {
  position: absolute;
  inset: 0;
  opacity: 0.1;
}
.modal-artist .modal-header-bg {
  background: #c8965a;
}
.modal-channel .modal-header-bg {
  background: #b87840;
}
.modal-media .modal-header-bg {
  background: #d4a843;
}
.modal-join .modal-header-bg {
  background: #f0c040;
}
.modal-feedback .modal-header-bg {
  background: #e8662a;
}
.modal-factory .modal-header-bg {
  background: #8a5a30;
}
.modal-close {
  position: absolute;
  z-index: 1;
  top: 20px;
  right: 20px;
  display: flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: rgb(44 31 20 / 8%);
  color: #2c1f14;
  font-size: 18px;
  transition:
    background 0.2s,
    transform 0.2s;
}
.modal-close:hover {
  background: rgb(44 31 20 / 14%);
  transform: rotate(90deg);
}
.modal-close:disabled {
  cursor: wait;
  opacity: 0.45;
}
.modal-icon {
  position: relative;
  display: block;
  margin-bottom: 12px;
  font-size: 44px;
}
.modal-title,
.modal-subtitle,
.modal-desc,
.form-note,
.form-error,
.success-title,
.success-body {
  margin: 0;
}
.modal-title {
  position: relative;
  margin-bottom: 6px;
  color: #2c1f14;
  font-size: clamp(22px, 4vw, 30px);
  font-weight: 900;
  letter-spacing: -0.02em;
}
.modal-subtitle {
  position: relative;
  color: #7a6552;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.7;
}
.modal-body {
  padding: 28px 36px 36px;
}
.modal-desc {
  margin-bottom: 22px;
  padding: 14px 18px;
  border-left: 3px solid #e8d8be;
  border-radius: 12px;
  background: #fffaf4;
  color: #7a6552;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.8;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.form-group {
  margin-bottom: 20px;
}
.form-label {
  display: block;
  margin-bottom: 8px;
  color: #7a6552;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.form-required {
  margin-left: 3px;
  color: #e8662a;
}
.form-input,
.form-textarea,
.form-select {
  width: 100%;
  padding: 14px 18px;
  border: 2px solid #e8d8be;
  border-radius: 14px;
  outline: none;
  background: #fffaf4;
  color: #2c1f14;
  font:
    700 15px/normal Nunito,
    'Noto Sans SC',
    sans-serif;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
  appearance: none;
}
.form-input:focus,
.form-textarea:focus,
.form-select:focus {
  border-color: #2c1f14;
  box-shadow: 0 0 0 4px rgb(44 31 20 / 6%);
}
.form-input::placeholder,
.form-textarea::placeholder {
  color: #c0aa88;
  font-weight: 700;
}
.form-textarea {
  min-height: 120px;
  resize: vertical;
  line-height: 1.7;
}
.form-select {
  cursor: pointer;
}
.file-upload {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  border: 2px dashed #e8d8be;
  border-radius: 14px;
  background: #fffaf4;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background 0.2s;
}
.file-upload:hover {
  border-color: #c0aa88;
  background: #e8d8be;
}
.file-upload input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.file-upload:focus-within {
  border-color: #2c1f14;
  box-shadow: 0 0 0 4px rgb(44 31 20 / 6%);
}
.file-upload-icon {
  font-size: 28px;
}
.file-upload-text,
.file-name {
  color: #7a6552;
  font-size: 13px;
  font-weight: 800;
  text-align: center;
  overflow-wrap: anywhere;
}
.file-name {
  color: #2c1f14;
}
.file-upload-sub {
  color: #c0aa88;
  font-size: 11px;
  font-weight: 700;
}
.checkbox-label {
  display: flex;
  align-items: flex-start;
  padding: 14px 16px;
  border: 2px solid #e8d8be;
  border-radius: 14px;
  background: #fffaf4;
  cursor: pointer;
  transition: border-color 0.2s;
}
.checkbox-label:hover {
  border-color: #c0aa88;
}
.checkbox-label input {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin: 1px 10px 0 0;
  accent-color: #2c1f14;
}
.checkbox-label span {
  color: #7a6552;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.6;
}
.form-error {
  margin-bottom: 12px;
  color: #c94000;
  font-size: 13px;
  font-weight: 800;
  text-align: center;
}
.form-submit {
  width: 100%;
  min-height: 56px;
  margin-top: 8px;
  padding: 16px;
  border: 0;
  border-radius: 999px;
  background: #2c1f14;
  color: #fff;
  font-size: 16px;
  font-weight: 900;
  letter-spacing: 0.03em;
  transition:
    opacity 0.2s,
    transform 0.2s;
}
.form-submit:hover {
  opacity: 0.85;
}
.form-submit:active {
  transform: scale(0.98);
}
.form-submit:disabled {
  cursor: wait;
  opacity: 0.6;
}
.form-note {
  margin-top: 14px;
  color: #7a6552;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.7;
  text-align: center;
}
.form-note a {
  text-decoration: underline;
}
.modal-success {
  display: flex;
  min-height: 360px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 60px 36px;
  text-align: center;
}
.success-icon {
  font-size: 64px;
  animation: contact-pop 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}
.success-title {
  color: #2c1f14;
  font-size: 28px;
  font-weight: 900;
  letter-spacing: -0.02em;
}
.success-body {
  max-width: 360px;
  color: #7a6552;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.8;
}
.success-close {
  min-height: 52px;
  margin-top: 8px;
  padding: 14px 36px;
  border: 0;
  border-radius: 999px;
  background: #2c1f14;
  color: #fff;
  font-size: 14px;
  font-weight: 900;
  transition: opacity 0.2s;
}
.success-close:hover {
  opacity: 0.8;
}
@keyframes contact-pop {
  from {
    transform: scale(0);
  }
  to {
    transform: scale(1);
  }
}
@media (max-width: 480px) {
  .form-row {
    grid-template-columns: 1fr;
  }
  .modal-header {
    padding: 30px 24px 24px;
  }
  .modal-body,
  .modal-success {
    padding-right: 24px;
    padding-left: 24px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .contact-modal-backdrop,
  .contact-modal,
  .modal-close,
  .form-submit,
  .success-icon {
    animation: none;
    transition: none;
  }
}
</style>
