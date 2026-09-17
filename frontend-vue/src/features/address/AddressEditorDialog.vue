<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import regionsJson from '@/assets/regions.json'
import { emptyAddress, smartParseAddress, validateAddress } from './address-utils'
import type { Address, AddressInput, RegionData } from './types'

const props = defineProps<{
  open: boolean
  address?: Address | null
  saving?: boolean
}>()
const emit = defineEmits<{
  close: []
  submit: [input: AddressInput]
}>()

const regions = regionsJson as RegionData
const form = reactive<AddressInput>(emptyAddress())
const smartText = ref('')
const smartHint = ref('粘贴后点击识别，或直接手动填写')
const smartHintTone = ref<'normal' | 'ok' | 'warn'>('normal')
const validationError = ref('')
const labels = ['家', '公司', '学校']

const selectedProvince = computed(() =>
  regions.provinces.find((province) => province.name === form.province)
)
const cities = computed(() => selectedProvince.value?.cities ?? [])
const districts = computed(
  () => cities.value.find((city) => city.name === form.city)?.districts ?? []
)

watch(
  () => [props.open, props.address] as const,
  ([open, address]) => {
    if (!open) return
    Object.assign(form, address ? addressToInput(address) : emptyAddress())
    smartText.value = ''
    smartHint.value = '粘贴后点击识别，或直接手动填写'
    smartHintTone.value = 'normal'
    validationError.value = ''
  },
  { immediate: true }
)

function addressToInput(address: Address): AddressInput {
  return {
    label: address.label,
    name: address.name,
    phone: address.phone,
    province: address.province,
    city: address.city,
    district: address.district,
    detail: address.detail
  }
}

function close(): void {
  if (!props.saving) emit('close')
}

function provinceChanged(): void {
  form.city = ''
  form.district = ''
}

function cityChanged(): void {
  form.district = ''
}

function parseSmartText(): void {
  if (!smartText.value.trim()) return
  const parsed = smartParseAddress(smartText.value, regions)
  form.name = parsed.name || form.name
  form.phone = parsed.phone || form.phone
  form.province = parsed.province || form.province
  form.city = parsed.city || form.city
  form.district = parsed.district || form.district
  form.detail = parsed.detail || form.detail
  if (parsed.confidence === 'high') {
    smartHint.value = '✅ 识别完成，请核对信息'
    smartHintTone.value = 'ok'
  } else if (parsed.confidence === 'medium') {
    smartHint.value = '⚠️ 部分字段未识别，请手动补全'
    smartHintTone.value = 'warn'
  } else {
    smartHint.value = '识别内容较少，请手动填写'
    smartHintTone.value = 'normal'
  }
}

function toggleLabel(label: string): void {
  form.label = form.label === label ? null : label
}

function submit(): void {
  const error = validateAddress(form)
  if (error) {
    validationError.value = error
    return
  }
  validationError.value = ''
  emit('submit', {
    ...form,
    name: form.name.trim(),
    phone: form.phone.trim(),
    detail: form.detail.trim()
  })
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) close()
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="address-modal-overlay open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="address-modal-title"
      @mousedown.self="close"
    >
      <form class="address-modal-box" @submit.prevent="submit">
        <div class="address-modal-title">
          <span id="address-modal-title">{{ address ? '编辑地址' : '新增地址' }}</span>
          <button class="address-modal-close" type="button" aria-label="关闭" @click="close">
            ✕
          </button>
        </div>

        <div class="smart-area">
          <div class="smart-label">🪄 智能识别（粘贴收件人信息，自动拆分）</div>
          <textarea
            v-model="smartText"
            class="smart-textarea"
            placeholder="粘贴如：张三 13800138000 广东省深圳市南山区科技园南路88号B座501"
          ></textarea>
          <div class="smart-footer">
            <span class="smart-hint" :class="smartHintTone">{{ smartHint }}</span>
            <button class="btn-parse" type="button" @click="parseSmartText">一键识别</button>
          </div>
        </div>

        <div class="form-row">
          <label class="form-group">
            <span class="address-form-label">收件人姓名 <b>*</b></span>
            <input
              v-model="form.name"
              class="address-form-input"
              maxlength="20"
              placeholder="姓名"
            />
          </label>
          <label class="form-group">
            <span class="address-form-label">手机号 <b>*</b></span>
            <input
              v-model="form.phone"
              class="address-form-input"
              inputmode="numeric"
              maxlength="11"
              placeholder="11位手机号"
            />
          </label>
        </div>

        <div class="form-row">
          <label class="form-group">
            <span class="address-form-label">省/直辖市 <b>*</b></span>
            <select v-model="form.province" class="address-form-select" @change="provinceChanged">
              <option value="">请选择省/直辖市</option>
              <option
                v-for="province in regions.provinces"
                :key="province.name"
                :value="province.name"
              >
                {{ province.name }}
              </option>
            </select>
          </label>
          <label class="form-group">
            <span class="address-form-label">市/州</span>
            <select
              v-model="form.city"
              class="address-form-select"
              :disabled="!form.province"
              @change="cityChanged"
            >
              <option value="">请选择市/州</option>
              <option v-for="city in cities" :key="city.name" :value="city.name">
                {{ city.name }}
              </option>
            </select>
          </label>
        </div>

        <div class="form-row full">
          <label class="form-group">
            <span class="address-form-label">区/县</span>
            <select v-model="form.district" class="address-form-select" :disabled="!form.city">
              <option value="">请选择区/县</option>
              <option v-for="district in districts" :key="district" :value="district">
                {{ district }}
              </option>
            </select>
          </label>
        </div>

        <div class="form-row full">
          <label class="form-group">
            <span class="address-form-label">详细地址 <b>*</b></span>
            <input
              v-model="form.detail"
              class="address-form-input"
              maxlength="200"
              placeholder="街道、楼栋、门牌号等"
            />
          </label>
        </div>

        <div class="form-group address-label-group">
          <span class="address-form-label">地址标签（可选）</span>
          <div class="label-tags">
            <button
              v-for="label in labels"
              :key="label"
              class="label-tag"
              :class="{ active: form.label === label }"
              type="button"
              @click="toggleLabel(label)"
            >
              {{ label === '家' ? '🏠' : label === '公司' ? '🏢' : '🎓' }} {{ label }}
            </button>
          </div>
        </div>

        <p v-if="validationError" class="address-form-error" role="alert">{{ validationError }}</p>
        <div class="address-modal-actions">
          <button class="address-btn-ghost" type="button" :disabled="saving" @click="close">
            取消
          </button>
          <button class="address-btn-primary" type="submit" :disabled="saving">
            {{ saving ? '保存中...' : '保存地址' }}
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.address-modal-overlay {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(0 0 0 / 50%);
}

.address-modal-box {
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 28px;
  border-radius: 24px;
  background: #fff;
}

.address-modal-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  font-size: 20px;
  font-weight: 900;
}

.address-modal-close {
  display: flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 0;
  border-radius: 50%;
  background: #ebebea;
  color: #787874;
  font-size: 18px;
}

.smart-area {
  margin-bottom: 18px;
  padding: 14px;
  border-radius: 14px;
  background: #f5f3ef;
}

.smart-label,
.address-form-label {
  display: block;
  margin-bottom: 8px;
  color: #787874;
  font-size: 12px;
  font-weight: 800;
}

.address-form-label {
  margin-bottom: 4px;
}

.address-form-label b {
  color: #ff6b35;
}

.smart-textarea,
.address-form-input,
.address-form-select {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid #ebebea;
  border-radius: 10px;
  outline: none;
  background: #fff;
  color: #111110;
  font:
    700 14px 'Nunito',
    'Noto Sans SC',
    sans-serif;
}

.smart-textarea {
  min-height: 68px;
  resize: vertical;
  font-size: 13px;
}

.smart-textarea:focus,
.address-form-input:focus,
.address-form-select:focus {
  border-color: #111110;
}

.address-form-select:disabled {
  background: #f5f3ef;
  color: #c4c3bf;
  cursor: not-allowed;
}

.smart-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  gap: 8px;
}

.smart-hint {
  color: #787874;
  font-size: 11px;
  font-weight: 700;
}

.smart-hint.ok {
  color: #27ae60;
}

.smart-hint.warn {
  color: #ff6b35;
}

.btn-parse {
  flex-shrink: 0;
  padding: 6px 14px;
  border: 0;
  border-radius: 999px;
  background: #111110;
  color: #fff;
  font-size: 12px;
  font-weight: 900;
}

.form-row {
  display: grid;
  margin-bottom: 12px;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.form-row.full {
  grid-template-columns: 1fr;
}

.form-group {
  min-width: 0;
}

.address-label-group {
  margin-top: 4px;
}

.label-tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: 4px;
  gap: 8px;
}

.label-tag {
  padding: 5px 12px;
  border: 1.5px solid #ebebea;
  border-radius: 999px;
  background: #fff;
  color: #787874;
  font-size: 12px;
  font-weight: 800;
}

.label-tag.active {
  border-color: #111110;
  background: #111110;
  color: #fff;
}

.address-form-error {
  margin: 12px 0 0;
  color: #c53030;
  font-size: 12px;
  font-weight: 700;
}

.address-modal-actions {
  display: flex;
  margin-top: 20px;
  gap: 10px;
}

.address-btn-primary,
.address-btn-ghost {
  flex: 1;
  padding: 12px 32px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 900;
}

.address-btn-primary {
  border: 0;
  background: #f5e642;
}

.address-btn-ghost {
  border: 1.5px solid #ebebea;
  background: transparent;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

@media (max-width: 480px) {
  .address-modal-overlay {
    padding: 14px;
  }

  .address-modal-box {
    padding: 22px;
  }

  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
