<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CustomizeProgress from '@/features/customize-start/CustomizeProgress.vue'
import {
  addCustomizationToCart,
  confirmSelection,
  loadConfirmation,
  parseConfirmationEntry
} from '@/features/customize-confirm/api'
import type { ConfirmationContext, SelectedVariant } from '@/features/customize-confirm/types'
import '@/features/customize-confirm/customize-confirm.css'

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const error = ref('')
const context = ref<ConfirmationContext | null>(null)
const selectedFrame = ref<number | null>(null)
const selectedSize = ref('')
const selectedMaterial = ref('')
const selectedSkuId = ref('')
const variants = ref<SelectedVariant[]>([])
const note = ref('')
const busy = ref(false)
let storageKey = ''
let flowKey = ''
let groupId = ''

const frameSkus = computed(
  () => context.value?.skus.filter((sku) => sku.frameCount === selectedFrame.value) ?? []
)
const sizes = computed(() => [...new Set(frameSkus.value.map((sku) => sku.size))].sort())
const materialSkus = computed(() =>
  frameSkus.value.filter((sku) => sku.size === selectedSize.value)
)
const materials = computed(() => [...new Set(materialSkus.value.map((sku) => sku.material))].sort())
const colorSkus = computed(() =>
  materialSkus.value.filter((sku) => sku.material === selectedMaterial.value)
)
const selectedSku = computed(
  () => colorSkus.value.find((sku) => sku.id === selectedSkuId.value) ?? null
)
const complete = computed(() =>
  Boolean(selectedFrame.value && selectedSize.value && selectedMaterial.value && selectedSku.value)
)
const total = computed(() => variants.value.reduce((sum, item) => sum + item.price, 0))
const missing = computed(() => {
  const items: string[] = []
  if (!selectedFrame.value) items.push('帧数规格')
  if (!selectedSize.value) items.push('尺寸')
  if (!selectedMaterial.value) items.push('材质')
  if (!selectedSku.value) items.push('颜色')
  return `还需选择：${items.join('、')}`
})
const mockClass = computed(() => {
  const type = context.value?.model.modelType ?? 'single'
  return ['lantern', 'hexagon', 'flat', 'mini'].includes(type) ? `mock-${type}` : 'mock-cylinder'
})

function stableValue(name: string): string {
  const key = `${storageKey}:${name}`
  let value = sessionStorage.getItem(key)
  if (!value) {
    value = crypto.randomUUID()
    sessionStorage.setItem(key, value)
  }
  return value
}

function saveSelection(): void {
  try {
    sessionStorage.setItem(`${storageKey}:variants`, JSON.stringify(variants.value))
    sessionStorage.setItem(`${storageKey}:note`, note.value)
  } catch {
    // 服务端幂等键仍保存在独立 session 项；选配缓存失败不改变提交授权。
  }
}

function restoreSelection(): void {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`${storageKey}:variants`) || '[]')
    if (Array.isArray(saved)) {
      const allowed = new Set(context.value?.skus.map((sku) => sku.id))
      variants.value = saved.filter(
        (item): item is SelectedVariant =>
          item &&
          typeof item.id === 'string' &&
          typeof item.skuId === 'string' &&
          allowed.has(item.skuId)
      )
    }
    note.value = (sessionStorage.getItem(`${storageKey}:note`) || '').slice(0, 1000)
  } catch {
    variants.value = []
  }
}

function chooseFrame(frame: number): void {
  selectedFrame.value = frame
  selectedSize.value = ''
  selectedMaterial.value = ''
  selectedSkuId.value = ''
}

function chooseSize(size: string): void {
  selectedSize.value = size
  selectedMaterial.value = ''
  selectedSkuId.value = ''
}

function chooseMaterial(material: string): void {
  selectedMaterial.value = material
  selectedSkuId.value = ''
}

function addVariant(): void {
  const sku = selectedSku.value
  if (!sku || !selectedFrame.value) return
  variants.value.push({
    id: crypto.randomUUID(),
    skuId: sku.id,
    frame: selectedFrame.value,
    size: sku.size,
    material: sku.material,
    colorName: sku.colorName,
    colorHex: sku.colorHex,
    price: sku.price
  })
  saveSelection()
  selectedSize.value = ''
  selectedMaterial.value = ''
  selectedSkuId.value = ''
}

function removeVariant(id: string): void {
  variants.value = variants.value.filter((item) => item.id !== id)
  saveSelection()
}

function includeCurrent(): void {
  if (!complete.value) return
  addVariant()
}

async function submit(): Promise<void> {
  if (busy.value || !context.value) return
  if (complete.value) includeCurrent()
  if (!variants.value.length) return
  busy.value = true
  error.value = ''
  saveSelection()
  try {
    const productId = await confirmSelection(context.value, variants.value, note.value, flowKey)
    const itemIds: string[] = []
    for (const variant of variants.value) {
      const id = await addCustomizationToCart({
        customProductId: productId,
        variant,
        flowKey,
        groupId
      })
      if (!itemIds.includes(id)) itemIds.push(id)
    }
    sessionStorage.setItem('mowo_checkout_items', JSON.stringify(itemIds))
    sessionStorage.removeItem(`${storageKey}:variants`)
    sessionStorage.removeItem(`${storageKey}:note`)
    await router.push('/checkout')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '提交失败，请稍后重试'
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  try {
    const entry = parseConfirmationEntry(route.query)
    storageKey = `mowo-confirm:${entry.mode}:${entry.requestId ?? entry.assetId}:${entry.modelId ?? ''}`
    flowKey = stableValue('flow')
    groupId = stableValue('group')
    context.value = await loadConfirmation(entry)
    restoreSelection()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '确认页加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <CustomizeProgress :active-step="3" :labels="['选型号', '上传 & 筛帧', '选款式', '提交订单']" />
  <div class="page-wrap confirm-page">
    <div v-if="loading" class="confirm-state">正在加载可用款式…</div>
    <div v-else-if="!context" class="confirm-state confirm-state-error">
      <strong>无法进入确认页</strong><span>{{ error }}</span>
      <RouterLink to="/customize">返回重新选择</RouterLink>
    </div>
    <div v-else class="confirm-layout">
      <div class="left-col">
        <div class="product-preview reveal on" id="productPreview">
          <div class="product-preview-mock">
            <div class="product-mock-shape" :class="mockClass"><div class="mock-ring"></div></div>
            <div class="preview-badge-row">
              <span class="preview-badge">{{ context.model.name }}</span>
            </div>
          </div>
          <p class="preview-img-placeholder">实物图占位</p>
        </div>
      </div>

      <div class="mid-col">
        <div class="config-block">
          <div class="config-section reveal d1 on">
            <div class="config-label"><span class="config-label-num">1</span>选择帧数规格</div>
            <p class="config-desc">根据你上传的动画，以下规格可用。帧数越多动画越流畅。</p>
            <div id="frameOptions" class="option-row">
              <button
                v-for="frame in context.validTargets"
                :key="frame"
                class="opt-btn"
                :class="{ selected: selectedFrame === frame }"
                @click="chooseFrame(frame)"
              >
                <span class="opt-name">{{ frame }} 帧</span>
                <span class="opt-price">{{
                  frame > context.baseFrameCount
                    ? `循环 ×${frame / context.baseFrameCount}`
                    : '原始帧数'
                }}</span>
              </button>
            </div>
          </div>
          <div v-if="selectedFrame" class="config-section reveal d2 on">
            <div class="config-label"><span class="config-label-num">2</span>选择尺寸</div>
            <p class="config-desc">尺寸影响最终产品大小。</p>
            <div id="sizeOptions" class="option-row">
              <button
                v-for="size in sizes"
                :key="size"
                class="opt-btn"
                :class="{ selected: selectedSize === size }"
                @click="chooseSize(size)"
              >
                <span class="opt-name">{{ size }}</span>
              </button>
            </div>
          </div>
          <div v-if="selectedSize" class="config-section reveal d2 on">
            <div class="config-label"><span class="config-label-num">3</span>选择材质</div>
            <p class="config-desc">不同材质影响重量、手感和价格。</p>
            <div id="materialOptions" class="option-row">
              <button
                v-for="material in materials"
                :key="material"
                class="opt-btn"
                :class="{ selected: selectedMaterial === material }"
                @click="chooseMaterial(material)"
              >
                <span class="opt-name">{{ material }}</span>
              </button>
            </div>
          </div>
          <div v-if="selectedMaterial" class="config-section reveal d3 on">
            <div class="config-label"><span class="config-label-num">4</span>选择颜色</div>
            <p class="config-desc">颜色选项根据所选材质自动更新。</p>
            <div id="colorOptions" class="option-row color-row">
              <button
                v-for="sku in colorSkus"
                :key="sku.id"
                class="color-choice"
                :class="{ selected: selectedSkuId === sku.id }"
                @click="selectedSkuId = sku.id"
              >
                <span class="color-opt" :style="{ background: sku.colorHex }"></span
                ><span class="color-label">{{ sku.colorName }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="right-col">
        <div class="price-card reveal on">
          <div class="price-card-current">
            <p class="price-card-current-label">当前配置</p>
            <div>
              <p class="price-card-machine">{{ context.model.name }}</p>
              <p class="price-card-title">
                {{
                  selectedSku
                    ? `${selectedSku.colorName} · ${selectedSku.size} · ${selectedFrame}帧`
                    : variants.length
                      ? `已选 ${variants.length} 款，继续配置新款式`
                      : '请完成选配'
                }}
              </p>
              <p class="price-card-sub">
                {{
                  selectedFrame
                    ? selectedFrame > context.baseFrameCount
                      ? `你的 ${context.baseFrameCount} 帧将循环补齐至 ${selectedFrame} 帧`
                      : `${selectedFrame} 帧动画`
                    : '—'
                }}
              </p>
            </div>
            <div class="price-display">
              <span class="price-unit">¥</span
              ><span class="price-big">{{ selectedSku ? selectedSku.price.toFixed(0) : '—' }}</span>
            </div>
            <div class="price-breakdown">
              <div class="breakdown-row">
                <span class="breakdown-label">基础价格</span
                ><span class="breakdown-val">{{
                  selectedSku ? `¥${selectedSku.price.toFixed(0)}` : '—'
                }}</span>
              </div>
              <div class="breakdown-row">
                <span class="breakdown-label">材质升级</span
                ><span class="breakdown-val">{{ selectedMaterial || '—' }}</span>
              </div>
              <div class="breakdown-row">
                <span class="breakdown-label">颜色定制</span
                ><span class="breakdown-val">{{ selectedSku?.colorName || '—' }}</span>
              </div>
              <div class="breakdown-divider"></div>
              <div class="breakdown-row breakdown-total">
                <span class="breakdown-label">小计</span
                ><span class="breakdown-val">{{
                  selectedSku ? `¥${selectedSku.price.toFixed(0)}` : '—'
                }}</span>
              </div>
            </div>
            <p v-if="!complete && !variants.length" class="config-incomplete">{{ missing }}</p>
            <button class="current-add-btn" :disabled="!complete" @click="addVariant">
              + 加入已选
            </button>
          </div>
          <div class="price-card-cart">
            <div class="price-card-cart-head">
              <span class="price-card-cart-label">已选款式</span
              ><span class="cart-count-badge" :class="{ show: variants.length }"
                >{{ variants.length }} 款</span
              >
            </div>
            <div v-if="variants.length" class="added-list has-items">
              <div v-for="item in variants" :key="item.id" class="added-item">
                <span class="added-item-swatch" :style="{ background: item.colorHex }"></span>
                <div class="added-item-info">
                  <p class="added-item-name">
                    {{ item.frame }}帧 · {{ item.size }} · {{ item.material }} ·
                    {{ item.colorName }}
                  </p>
                  <p class="added-item-price">¥{{ item.price.toFixed(0) }}</p>
                </div>
                <button class="added-item-remove" title="移除" @click="removeVariant(item.id)">
                  ✕
                </button>
              </div>
            </div>
            <p v-else class="cart-total-empty">尚未加入任何款式</p>
            <div v-if="variants.length" class="cart-total-row">
              <span class="cart-total-label">已选合计</span
              ><span class="cart-total-val">¥{{ total.toFixed(0) }}</span>
            </div>
          </div>
          <div class="price-info">
            <div class="info-row">
              <span class="info-icon">📦</span
              ><span class="info-text"
                ><strong>顺丰快递</strong> · 全国包邮，偏远地区补运费差价</span
              >
            </div>
            <div class="info-row">
              <span class="info-icon">⏱</span
              ><span class="info-text">生产周期 <strong>7—14 个工作日</strong>，节假日顺延</span>
            </div>
            <div class="info-row">
              <span class="info-icon">🔒</span
              ><span class="info-text"
                >按需生产，支持 <strong>7天无理由退换</strong>（定制品除外）</span
              >
            </div>
          </div>
          <div class="price-card-btns">
            <textarea
              v-model="note"
              class="order-note"
              maxlength="1000"
              placeholder="订单备注（选填）"
              @change="saveSelection"
            ></textarea>
            <p v-if="error" class="confirm-submit-error">{{ error }}</p>
            <button
              class="btn btn-yellow"
              :disabled="busy || (!complete && !variants.length)"
              @click="submit"
            >
              {{ busy ? '正在提交' : '提交订单 →' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
