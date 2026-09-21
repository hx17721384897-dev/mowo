<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ApiError } from '@/services/api-client'
import {
  createAddress,
  deleteAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress
} from './api'
import { maskAddressPhone } from './address-utils'
import AddressEditorDialog from './AddressEditorDialog.vue'
import type { Address, AddressInput } from './types'

const props = withDefaults(
  defineProps<{
    mode: 'manage' | 'select'
    modelValue?: string | null
  }>(),
  { modelValue: null }
)
const emit = defineEmits<{
  'update:modelValue': [id: string]
  selected: [address: Address | null]
  notice: [message: string, tone: 'success' | 'error' | 'neutral']
}>()

const addresses = ref<Address[]>([])
const loading = ref(true)
const loadError = ref('')
const editorOpen = ref(false)
const editingAddress = ref<Address | null>(null)
const saving = ref(false)
const deleting = ref(false)
const pendingDelete = ref<Address | null>(null)
const settingDefaultId = ref<string | null>(null)

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError || cause instanceof Error ? cause.message : fallback
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    addresses.value = await listAddresses()
    if (props.mode === 'select') {
      const preferred =
        addresses.value.find((address) => address.id === props.modelValue) ??
        addresses.value.find((address) => address.isDefault) ??
        addresses.value[0]
      if (preferred) select(preferred)
      else emit('selected', null)
    }
  } catch (cause) {
    loadError.value = messageOf(cause, '加载失败，请刷新重试')
  } finally {
    loading.value = false
  }
}

function select(address: Address): void {
  if (props.mode !== 'select') return
  emit('update:modelValue', address.id)
  emit('selected', address)
}

function openCreate(): void {
  editingAddress.value = null
  editorOpen.value = true
}

function openEdit(address: Address): void {
  editingAddress.value = address
  editorOpen.value = true
}

async function save(input: AddressInput): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    const saved = editingAddress.value
      ? await updateAddress(editingAddress.value.id, input)
      : await createAddress(input)
    editorOpen.value = false
    emit('notice', editingAddress.value ? '地址已更新' : '地址已添加', 'success')
    await load()
    if (props.mode === 'select') select(saved)
  } catch (cause) {
    emit('notice', messageOf(cause, '保存失败'), 'error')
  } finally {
    saving.value = false
  }
}

async function makeDefault(address: Address): Promise<void> {
  if (settingDefaultId.value) return
  settingDefaultId.value = address.id
  try {
    await setDefaultAddress(address.id)
    emit('notice', '已设为默认地址', 'success')
    await load()
  } catch (cause) {
    emit('notice', messageOf(cause, '操作失败'), 'error')
  } finally {
    settingDefaultId.value = null
  }
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value || deleting.value) return
  deleting.value = true
  try {
    await deleteAddress(pendingDelete.value.id)
    pendingDelete.value = null
    emit('notice', '地址已删除', 'success')
    await load()
  } catch (cause) {
    emit('notice', messageOf(cause, '删除失败'), 'error')
  } finally {
    deleting.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="address-book">
    <div class="address-book__header">
      <h2>收货地址</h2>
      <button class="address-add" type="button" @click="openCreate">＋ 新增地址</button>
    </div>

    <div v-if="loading" class="address-state">加载中...</div>
    <div v-else-if="loadError" class="address-state error" role="alert">
      <span>{{ loadError }}</span>
      <button type="button" @click="load">重新加载</button>
    </div>
    <div v-else-if="addresses.length === 0" class="address-empty">
      <div class="address-empty__icon">📍</div>
      <div class="address-empty__title">还没有收货地址</div>
      <div class="address-empty__desc">添加常用地址，下次购买更快捷</div>
    </div>
    <div v-else class="address-list">
      <article
        v-for="address in addresses"
        :key="address.id"
        class="address-card"
        :class="{
          'is-default': address.isDefault,
          'is-selected': mode === 'select' && modelValue === address.id
        }"
        @click="select(address)"
      >
        <input
          v-if="mode === 'select'"
          class="address-radio"
          type="radio"
          name="shipping-address"
          :value="address.id"
          :checked="modelValue === address.id"
          :aria-label="`选择 ${address.name} 的地址`"
          @change="select(address)"
        />
        <div class="card-main">
          <div class="card-top">
            <span v-if="address.isDefault" class="tag-default">默认</span>
            <span v-if="address.label" class="tag-label">{{ address.label }}</span>
          </div>
          <div>
            <span class="card-name">{{ address.name }}</span>
            <span class="card-phone">{{ maskAddressPhone(address.phone) }}</span>
          </div>
          <div class="card-address">
            {{
              [address.province, address.city, address.district, address.detail]
                .filter(Boolean)
                .join(' ')
            }}
          </div>
        </div>
        <div v-if="mode === 'manage'" class="card-actions">
          <button
            v-if="!address.isDefault"
            class="card-action set-default"
            type="button"
            :disabled="settingDefaultId !== null"
            @click="makeDefault(address)"
          >
            {{ settingDefaultId === address.id ? '设置中...' : '设为默认' }}
          </button>
          <button class="card-action" type="button" @click="openEdit(address)">编辑</button>
          <button class="card-action delete" type="button" @click="pendingDelete = address">
            删除
          </button>
        </div>
      </article>
    </div>

    <AddressEditorDialog
      :open="editorOpen"
      :address="editingAddress"
      :saving="saving"
      @close="editorOpen = false"
      @submit="save"
    />

    <Teleport to="body">
      <div
        v-if="pendingDelete"
        class="confirm-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-address-title"
      >
        <div class="confirm-box">
          <h2 id="delete-address-title">删除地址</h2>
          <p>
            确定删除{{ pendingDelete.label ? `「${pendingDelete.label}」` : ''
            }}{{ pendingDelete.name }}的地址吗？
          </p>
          <div class="confirm-actions">
            <button type="button" :disabled="deleting" @click="pendingDelete = null">取消</button>
            <button class="danger" type="button" :disabled="deleting" @click="confirmDelete">
              {{ deleting ? '删除中...' : '确认' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.address-book__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  gap: 12px;
}

.address-book__header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 900;
}

.address-add {
  flex-shrink: 0;
  padding: 9px 20px;
  border: 0;
  border-radius: 999px;
  background: #f5e642;
  color: #111110;
  font-size: 13px;
  font-weight: 900;
}

.address-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.address-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 20px;
  border: 1.5px solid #ebebea;
  border-radius: 16px;
  background: #fff;
  gap: 12px;
}

.address-card.is-default,
.address-card.is-selected {
  border-color: #f5e642;
}

.address-card.is-selected {
  cursor: pointer;
}

.address-radio {
  flex-shrink: 0;
  margin-top: 3px;
  accent-color: #111110;
}

.card-main {
  min-width: 0;
  flex: 1;
}

.card-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 6px;
  gap: 8px;
}

.tag-default,
.tag-label {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 900;
}

.tag-default {
  background: #f5e642;
  color: #111110;
}

.tag-label {
  background: #ebebea;
  color: #787874;
  font-weight: 800;
}

.card-name {
  font-size: 15px;
  font-weight: 900;
}

.card-phone {
  margin-left: 8px;
  color: #787874;
  font-size: 13px;
  font-weight: 700;
}

.card-address {
  margin-top: 4px;
  color: #787874;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
  gap: 4px;
}

.card-action {
  padding: 9px 18px;
  border: 1.5px solid #ebebea;
  border-radius: 999px;
  background: transparent;
  color: #111110;
  font-size: 13px;
  font-weight: 800;
}

.card-action.set-default {
  border-color: #f5e642;
}

.card-action.delete {
  border-color: #fdd;
  color: #e74c3c;
}

.card-action:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.address-state,
.address-empty {
  padding: 60px 20px;
  color: #787874;
  text-align: center;
  font-size: 14px;
  font-weight: 700;
}

.address-state.error {
  color: #c53030;
}

.address-state button {
  margin-left: 8px;
  padding: 6px 12px;
  border: 1px solid currentcolor;
  border-radius: 999px;
  background: transparent;
}

.address-empty__icon {
  margin-bottom: 16px;
  font-size: 48px;
}

.address-empty__title {
  margin-bottom: 8px;
  color: #111110;
  font-size: 18px;
  font-weight: 900;
}

.confirm-overlay {
  position: fixed;
  z-index: 1100;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(0 0 0 / 50%);
}

.confirm-box {
  width: 100%;
  max-width: 400px;
  padding: 28px;
  border-radius: 24px;
  background: #fff;
}

.confirm-box h2 {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 900;
}

.confirm-box p {
  margin: 0 0 20px;
  color: #787874;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.6;
}

.confirm-actions {
  display: flex;
  gap: 10px;
}

.confirm-actions button {
  flex: 1;
  padding: 12px 32px;
  border: 1.5px solid #ebebea;
  border-radius: 999px;
  background: transparent;
  font-weight: 800;
}

.confirm-actions .danger {
  border-color: #feb2b2;
  background: #fff5f5;
  color: #c53030;
  font-weight: 900;
}

@media (max-width: 600px) {
  .address-card {
    flex-wrap: wrap;
  }

  .card-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
