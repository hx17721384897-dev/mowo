<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent, vue/multiline-html-element-content-newline */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AdminSidebar from '@/components/AdminSidebar.vue'
import { safeReviewImage } from '@/features/admin-collab-review/api'
import {
  createCatalogSku,
  deleteCatalogExampleImage,
  deleteCatalogModel,
  deleteCatalogSku,
  getCatalogBom,
  getCatalogExampleImageUrl,
  getCatalogSkuImageUrl,
  listCatalogInventory,
  listCatalogMaterials,
  listCatalogModels,
  reorderCatalogModels,
  reorderCatalogSkus,
  saveCatalogBom,
  saveCatalogModel,
  setCatalogModelActive,
  setCatalogSkuActive,
  setCatalogSkuPrice,
  uploadCatalogExampleImage,
  uploadCatalogSkuImage,
  type CatalogBomItem,
  type CatalogInventory,
  type CatalogMaterial,
  type CatalogModel,
  type CatalogSku
} from '@/features/admin-catalog/api'
import './admin-models.css'

type Modal = 'model' | 'sku' | 'delete-model' | 'delete-sku' | 'sort' | 'examples' | 'bom' | null
type OptionColor = { name: string; hex: string }
type SortItem = { id: string; name: string; sub: string }

const SIZE_KEY = 'mowo_sku_sizes'
const MATERIAL_KEY = 'mowo_sku_materials'
const FRAME_KEY = 'mowo_sku_frames'
const COLOR_KEY = 'mowo_sku_colors'
const defaults = {
  sizes: ['5x5cm', '8x8cm'],
  materials: ['椴木板', '亚克力'],
  frames: [6, 8, 10, 12, 16, 18, 24, 30, 36],
  colors: [
    { name: '原色', hex: '#D4B896' },
    { name: '深棕', hex: '#6B3A2A' },
    { name: '浅灰', hex: '#C8C8C8' },
    { name: '透明', hex: '#F0F0F0' }
  ] as OptionColor[]
}
function localList<T>(key: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null')
    return Array.isArray(parsed) ? parsed : [...fallback]
  } catch {
    return [...fallback]
  }
}
const sizes = ref<string[]>(localList(SIZE_KEY, defaults.sizes))
const materials = ref<string[]>(localList(MATERIAL_KEY, defaults.materials))
const frames = ref<number[]>(localList(FRAME_KEY, defaults.frames))
const colors = ref<OptionColor[]>(localList(COLOR_KEY, defaults.colors))
watch(sizes, (value) => localStorage.setItem(SIZE_KEY, JSON.stringify(value)), { deep: true })
watch(materials, (value) => localStorage.setItem(MATERIAL_KEY, JSON.stringify(value)), {
  deep: true
})
watch(frames, (value) => localStorage.setItem(FRAME_KEY, JSON.stringify(value)), { deep: true })
watch(colors, (value) => localStorage.setItem(COLOR_KEY, JSON.stringify(value)), { deep: true })

const mobileOpen = ref(false)
const collapsed = ref(false)
const models = ref<CatalogModel[]>([])
const inventories = ref(new Map<string, CatalogInventory>())
const skuImages = ref(new Map<string, string>())
const expanded = ref(new Set<string>())
const loading = ref(true)
const error = ref('')
const busy = ref(false)
const notice = ref('')
const modal = ref<Modal>(null)
const selectedModel = ref<CatalogModel | null>(null)
const selectedSku = ref<CatalogSku | null>(null)
let noticeTimer: number | undefined
let loadSequence = 0

const modelForm = ref({
  name: '',
  description: '',
  previewImage: '',
  videoUrl: '',
  modelType: 'single' as CatalogModel['modelType']
})
const skuForm = ref({
  size: '',
  material: '',
  frameCount: '',
  colorName: '',
  colorHex: '#D4B896',
  price: ''
})
const optionDraft = ref({ size: '', material: '', frame: '', colorName: '', colorHex: '#D4B896' })
const priceEditId = ref('')
const priceDraft = ref('')
const sortMode = ref<'model' | 'sku'>('model')
const sortItems = ref<SortItem[]>([])
const dragIndex = ref<number | null>(null)
const examples = ref<Array<{ key: string; url: string }>>([])
const exampleLoading = ref(false)
const materialsList = ref<CatalogMaterial[]>([])
const bomSelected = ref(new Map<string, number>())
const bomSearch = ref('')
const bomLoading = ref(false)

const filteredMaterials = computed(() => {
  const q = bomSearch.value.trim().toLowerCase()
  return materialsList.value.filter((item) =>
    `${item.name} ${item.itemCode || ''} ${item.specification || ''}`.toLowerCase().includes(q)
  )
})
function flash(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 2800)
}
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : '网络错误'
}
function resetModal(): void {
  modal.value = null
  selectedSku.value = null
  document.body.style.overflow = ''
}
function closeModal(): void {
  if (busy.value) return
  resetModal()
}
function openModal(kind: Exclude<Modal, null>): void {
  modal.value = kind
  document.body.style.overflow = 'hidden'
}
function parseExampleKeys(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}
function modelPrice(model: CatalogModel): string {
  const prices = model.skus
    .filter((sku) => sku.isActive && Number(sku.price) > 0)
    .map((sku) => Number(sku.price))
  if (!prices.length) return '暂无定价'
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  return min === max ? `¥${min}` : `¥${min} ~ ¥${max}`
}
function stock(skuId: string): { text: string; level: string } {
  const item = inventories.value.get(skuId)
  if (!item) return { text: '—', level: '' }
  return {
    text: item.isOut ? '缺货' : String(item.currentStock - item.reservedStock),
    level: item.isOut ? 'out' : item.isLow ? 'low' : 'normal'
  }
}
async function load(): Promise<void> {
  const sequence = ++loadSequence
  const keep = new Set(expanded.value)
  loading.value = true
  error.value = ''
  try {
    const [nextModels, nextInventory] = await Promise.all([
      listCatalogModels(),
      listCatalogInventory()
    ])
    if (sequence !== loadSequence) return
    models.value = nextModels
    inventories.value = new Map(nextInventory.map((item) => [item.skuId, item]))
    expanded.value = keep
    const entries = await Promise.all(
      nextModels
        .flatMap((model) => model.skus)
        .filter((sku) => sku.previewImage)
        .map(async (sku) => {
          try {
            return [sku.id, (await getCatalogSkuImageUrl(sku.id)).previewUrl || ''] as const
          } catch {
            return [sku.id, ''] as const
          }
        })
    )
    if (sequence === loadSequence) skuImages.value = new Map(entries.filter((entry) => !!entry[1]))
  } catch (cause) {
    if (sequence === loadSequence) error.value = message(cause)
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}
function toggleCard(id: string): void {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
function openModel(model: CatalogModel | null): void {
  selectedModel.value = model
  modelForm.value = {
    name: model?.name || '',
    description: model?.description || '',
    previewImage: model?.previewImage || '',
    videoUrl: model?.videoUrl || '',
    modelType: model?.modelType || 'single'
  }
  openModal('model')
}
async function submitModel(): Promise<void> {
  if (busy.value) return
  if (!modelForm.value.name.trim()) return flash('请填写款式名称')
  if (!modelForm.value.description.trim()) return flash('请填写款式介绍')
  busy.value = true
  try {
    await saveCatalogModel(selectedModel.value?.id || null, {
      name: modelForm.value.name.trim(),
      description: modelForm.value.description.trim(),
      previewImage: modelForm.value.previewImage.trim() || null,
      videoUrl: modelForm.value.videoUrl.trim() || null,
      modelType: modelForm.value.modelType
    })
    flash(selectedModel.value ? '✓ 款式已更新' : '✓ 款式已创建')
    resetModal()
    await load()
  } catch (cause) {
    flash(`操作失败：${message(cause)}`)
  } finally {
    busy.value = false
  }
}
async function toggleModel(model: CatalogModel): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await setCatalogModelActive(model.id, !model.isActive)
    flash(model.isActive ? '✓ 款式已下架' : '✓ 款式已上架')
    await load()
  } catch (cause) {
    flash(`操作失败：${message(cause)}`)
  } finally {
    busy.value = false
  }
}
function confirmDeleteModel(model: CatalogModel): void {
  selectedModel.value = model
  openModal('delete-model')
}
async function removeModel(): Promise<void> {
  if (busy.value || !selectedModel.value) return
  busy.value = true
  try {
    await deleteCatalogModel(selectedModel.value.id)
    flash('✓ 款式已删除')
    resetModal()
    await load()
  } catch (cause) {
    flash(`删除失败：${message(cause)}`)
  } finally {
    busy.value = false
  }
}
function openSku(model: CatalogModel): void {
  selectedModel.value = model
  skuForm.value = {
    size: '',
    material: '',
    frameCount: '',
    colorName: '',
    colorHex: '#D4B896',
    price: ''
  }
  openModal('sku')
}
function addOption(type: 'size' | 'material' | 'frame' | 'color'): void {
  if (
    type === 'size' &&
    optionDraft.value.size.trim() &&
    !sizes.value.includes(optionDraft.value.size.trim())
  )
    sizes.value.push(optionDraft.value.size.trim())
  if (
    type === 'material' &&
    optionDraft.value.material.trim() &&
    !materials.value.includes(optionDraft.value.material.trim())
  )
    materials.value.push(optionDraft.value.material.trim())
  if (type === 'frame') {
    const value = Number(optionDraft.value.frame)
    if (Number.isInteger(value) && value > 0 && !frames.value.includes(value))
      frames.value.push(value)
  }
  if (
    type === 'color' &&
    optionDraft.value.colorName.trim() &&
    !colors.value.some((item) => item.name === optionDraft.value.colorName.trim())
  )
    colors.value.push({ name: optionDraft.value.colorName.trim(), hex: optionDraft.value.colorHex })
  optionDraft.value = { size: '', material: '', frame: '', colorName: '', colorHex: '#D4B896' }
}
function removeOption(type: 'size' | 'material' | 'frame' | 'color', value: string): void {
  if (type === 'size') sizes.value = sizes.value.filter((item) => item !== value)
  if (type === 'material') materials.value = materials.value.filter((item) => item !== value)
  if (type === 'frame') frames.value = frames.value.filter((item) => String(item) !== value)
  if (type === 'color') colors.value = colors.value.filter((item) => item.name !== value)
}
function removeSelectedOption(type: 'size' | 'material' | 'frame' | 'color'): void {
  const field = type === 'frame' ? 'frameCount' : type === 'color' ? 'colorName' : type
  const value = skuForm.value[field]
  if (!value) return
  removeOption(type, value)
  skuForm.value[field] = ''
}
function chooseColor(): void {
  const color = colors.value.find((item) => item.name === skuForm.value.colorName)
  if (color) skuForm.value.colorHex = color.hex
}
async function submitSku(): Promise<void> {
  if (busy.value || !selectedModel.value) return
  const frameCount = Number(skuForm.value.frameCount)
  const price = Number(skuForm.value.price)
  if (
    !skuForm.value.size ||
    !skuForm.value.material ||
    !Number.isInteger(frameCount) ||
    frameCount <= 0 ||
    !skuForm.value.colorName ||
    !Number.isFinite(price) ||
    price < 0
  )
    return flash('请完整填写有效的 SKU 规格与价格')
  busy.value = true
  try {
    await createCatalogSku(selectedModel.value.id, { ...skuForm.value, frameCount, price })
    const modelId = selectedModel.value.id
    flash('✓ SKU 已创建，库存记录已自动建立')
    resetModal()
    expanded.value = new Set([...expanded.value, modelId])
    await load()
  } catch (cause) {
    flash(`操作失败：${message(cause)}`)
  } finally {
    busy.value = false
  }
}
async function toggleSku(sku: CatalogSku): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await setCatalogSkuActive(sku.id, !sku.isActive)
    flash(sku.isActive ? '✓ 该SKU已下架' : '✓ 该SKU已上架')
    await load()
  } catch (cause) {
    flash(`操作失败：${message(cause)}`)
  } finally {
    busy.value = false
  }
}
function confirmDeleteSku(sku: CatalogSku): void {
  selectedSku.value = sku
  openModal('delete-sku')
}
async function removeSku(): Promise<void> {
  if (busy.value || !selectedSku.value) return
  busy.value = true
  try {
    await deleteCatalogSku(selectedSku.value.id)
    flash('✓ SKU 已删除')
    resetModal()
    await load()
  } catch (cause) {
    flash(`删除失败：${message(cause)}`)
  } finally {
    busy.value = false
  }
}
function startPrice(sku: CatalogSku): void {
  priceEditId.value = sku.id
  priceDraft.value = String(Number(sku.price))
}
async function savePrice(sku: CatalogSku): Promise<void> {
  const price = Number(priceDraft.value)
  if (busy.value || !Number.isFinite(price) || price < 0) return flash('请输入有效价格')
  busy.value = true
  try {
    await setCatalogSkuPrice(sku.id, price)
    sku.price = price
    priceEditId.value = ''
    flash(`✓ 价格已更新为 ¥${price}`)
  } catch (cause) {
    flash(`更新失败：${message(cause)}`)
  } finally {
    busy.value = false
  }
}
async function uploadSkuImage(sku: CatalogSku, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024)
    return flash('请选择不超过 5MB 的图片')
  if (busy.value) return
  busy.value = true
  try {
    const result = await uploadCatalogSkuImage(sku.id, file)
    sku.previewImage = result.previewImage
    skuImages.value = new Map(skuImages.value).set(sku.id, result.previewUrl)
    flash('✓ 图片已上传')
  } catch (cause) {
    flash(`上传失败：${message(cause)}`)
  } finally {
    busy.value = false
  }
}
function openSort(mode: 'model' | 'sku', model?: CatalogModel): void {
  sortMode.value = mode
  selectedModel.value = model || null
  sortItems.value =
    mode === 'model'
      ? models.value.map((item) => ({
          id: item.id,
          name: item.name,
          sub: `${item.skus.length} 个SKU`
        }))
      : (model?.skus || []).map((item) => ({
          id: item.id,
          name: `${item.size} · ${item.material}`,
          sub: `${item.frameCount}帧 · ${item.colorName}`
        }))
  openModal('sort')
}
function moveSort(index: number, offset: number): void {
  const target = index + offset
  if (target < 0 || target >= sortItems.value.length) return
  const next = [...sortItems.value]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  sortItems.value = next
}
function startSortDrag(index: number): void {
  dragIndex.value = index
}
function dropSort(index: number): void {
  const source = dragIndex.value
  dragIndex.value = null
  if (source === null || source === index) return
  const next = [...sortItems.value]
  const [item] = next.splice(source, 1)
  if (!item) return
  next.splice(index, 0, item)
  sortItems.value = next
}
async function submitSort(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const ids = sortItems.value.map((item) => item.id)
    if (sortMode.value === 'model') await reorderCatalogModels(ids)
    else if (selectedModel.value) await reorderCatalogSkus(selectedModel.value.id, ids)
    flash('✓ 顺序已保存')
    resetModal()
    await load()
  } catch (cause) {
    flash(`保存失败：${message(cause)}`)
  } finally {
    busy.value = false
  }
}
async function openExamples(sku: CatalogSku): Promise<void> {
  selectedSku.value = sku
  examples.value = []
  exampleLoading.value = true
  openModal('examples')
  try {
    examples.value = await Promise.all(
      parseExampleKeys(sku.exampleMedia).map(async (key) => {
        try {
          return { key, url: (await getCatalogExampleImageUrl(sku.id, key)).url }
        } catch {
          return { key, url: '' }
        }
      })
    )
  } finally {
    exampleLoading.value = false
  }
}
async function uploadExample(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !selectedSku.value || busy.value) return
  if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024)
    return flash('请选择不超过 5MB 的图片')
  busy.value = true
  try {
    const result = await uploadCatalogExampleImage(selectedSku.value.id, file)
    selectedSku.value.exampleMedia = JSON.stringify(result.exampleMedia)
    await openExamples(selectedSku.value)
    flash('示例图已上传')
  } catch (cause) {
    flash(`上传失败：${message(cause)}`)
  } finally {
    busy.value = false
  }
}
async function removeExample(item: { key: string }): Promise<void> {
  if (!selectedSku.value || busy.value || !window.confirm('确认删除此示例图？')) return
  busy.value = true
  try {
    const result = await deleteCatalogExampleImage(selectedSku.value.id, item.key)
    selectedSku.value.exampleMedia = JSON.stringify(result.exampleMedia)
    examples.value = examples.value.filter((row) => row.key !== item.key)
    flash('已删除')
  } catch (cause) {
    flash(`删除失败：${message(cause)}`)
  } finally {
    busy.value = false
  }
}
async function openBom(sku: CatalogSku): Promise<void> {
  selectedSku.value = sku
  bomLoading.value = true
  bomSearch.value = ''
  bomSelected.value = new Map()
  openModal('bom')
  try {
    const [all, bom] = await Promise.all([listCatalogMaterials(), getCatalogBom(sku.id)])
    materialsList.value = all
    bomSelected.value = new Map(bom.items.map((item) => [item.materialId, item.qtyPerUnit]))
  } catch (cause) {
    flash(`材料清单加载失败：${message(cause)}`)
  } finally {
    bomLoading.value = false
  }
}
function toggleBom(item: CatalogMaterial, checked: boolean): void {
  const next = new Map(bomSelected.value)
  if (checked) next.set(item.id, next.get(item.id) || 1)
  else next.delete(item.id)
  bomSelected.value = next
}
function setBomQty(id: string, value: string): void {
  const qty = Number(value)
  if (!Number.isInteger(qty) || qty <= 0) return
  const next = new Map(bomSelected.value)
  if (next.has(id)) next.set(id, qty)
  bomSelected.value = next
}
async function submitBom(): Promise<void> {
  if (!selectedSku.value || busy.value) return
  const items: CatalogBomItem[] = [...bomSelected.value].map(([materialId, qtyPerUnit]) => ({
    materialId,
    qtyPerUnit
  }))
  busy.value = true
  try {
    await saveCatalogBom(selectedSku.value.id, items)
    flash('✓ 材料清单已保存')
    resetModal()
  } catch (cause) {
    flash(`保存失败：${message(cause)}`)
  } finally {
    busy.value = false
  }
}
watch(modal, (value) => {
  if (!value) document.body.style.overflow = ''
})
onMounted(() => {
  void load()
})
onBeforeUnmount(() => {
  ++loadSequence
  window.clearTimeout(noticeTimer)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="admin-models-page">
    <AdminSidebar v-model:collapsed="collapsed" v-model:mobile-open="mobileOpen" />
    <main class="catalog-main" :class="{ expanded: collapsed }">
      <header class="catalog-topbar">
        <button class="catalog-menu" type="button" aria-label="打开菜单" @click="mobileOpen = true">
          ☰
        </button>
        <span class="catalog-title">款式管理</span>
        <button class="catalog-btn ghost small" type="button" :disabled="loading" @click="load">
          ↻ 刷新
        </button>
      </header>
      <div class="catalog-content">
        <div class="catalog-toolbar">
          <div>
            共 <strong>{{ models.length }}</strong> 个款式
          </div>
          <div class="catalog-actions">
            <button class="catalog-btn ghost" type="button" @click="openSort('model')">
              ↕ 调整款式顺序
            </button>
            <button class="catalog-btn black" type="button" @click="openModel(null)">
              ＋ 新增款式
            </button>
          </div>
        </div>
        <div v-if="loading" class="catalog-empty">正在加载…</div>
        <div v-else-if="error" class="catalog-empty">
          加载失败：{{ error }} <button class="catalog-btn ghost small" @click="load">重试</button>
        </div>
        <div v-else-if="!models.length" class="catalog-empty">暂无款式，点击右上角新增</div>
        <div v-else class="catalog-grid">
          <article
            v-for="model in models"
            :key="model.id"
            class="catalog-card"
            :class="{ inactive: !model.isActive }"
          >
            <div class="catalog-card-head" @click="toggleCard(model.id)">
              <div class="catalog-head-left">
                <i :class="model.isActive ? 'active' : ''"></i>
                <div class="catalog-preview">
                  <img
                    v-if="safeReviewImage(model.previewImage)"
                    :src="safeReviewImage(model.previewImage)!"
                    alt=""
                  /><span v-else>📦</span>
                </div>
                <div class="catalog-name-wrap">
                  <b>{{ model.name }}</b
                  ><small>{{ model.description || '暂无介绍' }}</small>
                </div>
              </div>
              <div class="catalog-head-right" @click.stop>
                <span class="catalog-sku-count">{{ model.skus.length }} 个SKU</span>
                <span class="catalog-price" :class="{ empty: modelPrice(model) === '暂无定价' }">{{
                  modelPrice(model)
                }}</span>
                <button
                  class="catalog-status"
                  :class="model.isActive ? 'on' : 'off'"
                  :disabled="busy"
                  @click="toggleModel(model)"
                >
                  {{ model.isActive ? '● 已上架' : '○ 已下架' }}
                </button>
                <button class="catalog-btn ghost small" @click="openModel(model)">编辑</button>
                <button class="catalog-btn red small" @click="confirmDeleteModel(model)">
                  删除
                </button>
                <button
                  class="catalog-expand"
                  type="button"
                  :aria-label="expanded.has(model.id) ? '收起规格' : '展开规格'"
                  @click="toggleCard(model.id)"
                >
                  ▾
                </button>
              </div>
            </div>
            <div v-if="expanded.has(model.id)" class="catalog-card-body">
              <div v-if="!model.isActive" class="catalog-offline">
                ⚠️ 此款式整体已下架，用户暂时看不到任何规格
              </div>
              <div v-if="!model.skus.length" class="catalog-empty compact">
                暂无SKU，点击下方按钮添加第一个规格
              </div>
              <div v-else class="catalog-table-wrap">
                <div class="catalog-table-head">
                  <span>图片</span><span>尺寸</span><span>材质</span><span>帧数</span
                  ><span>颜色</span><span>价格</span><span>库存</span><span>上下架</span
                  ><span>操作</span>
                </div>
                <div
                  v-for="sku in model.skus"
                  :key="sku.id"
                  class="catalog-sku-row"
                  :class="{ inactive: !sku.isActive }"
                >
                  <label class="catalog-sku-image" title="点击上传或更换图片"
                    ><img v-if="skuImages.get(sku.id)" :src="skuImages.get(sku.id)" alt="" /><span
                      v-else
                      >＋</span
                    ><input type="file" accept="image/*" @change="uploadSkuImage(sku, $event)"
                  /></label>
                  <b>{{ sku.size }}</b
                  ><span>{{ sku.material }}</span
                  ><b>{{ sku.frameCount }} 帧</b>
                  <span class="catalog-color"
                    ><i
                      :style="{
                        background: /^#[0-9a-f]{6}$/i.test(sku.colorHex) ? sku.colorHex : '#c4c3bf'
                      }"
                    ></i
                    ><span
                      ><b>{{ sku.colorName }}</b
                      ><small>{{ sku.colorHex }}</small></span
                    ></span
                  >
                  <span
                    v-if="priceEditId !== sku.id"
                    class="catalog-price-cell"
                    @click="startPrice(sku)"
                    >¥{{ Number(sku.price).toFixed(0) }} ✏</span
                  >
                  <span v-else class="catalog-price-edit"
                    ><input
                      v-model="priceDraft"
                      type="number"
                      min="0"
                      @keydown.enter="savePrice(sku)"
                      @keydown.esc="priceEditId = ''"
                    /><button @click="savePrice(sku)">✓</button
                    ><button @click="priceEditId = ''">×</button></span
                  >
                  <span class="catalog-stock" :class="stock(sku.id).level">{{
                    stock(sku.id).text
                  }}</span>
                  <button
                    class="catalog-status sku"
                    :class="sku.isActive ? 'on' : 'off'"
                    :disabled="busy"
                    @click="toggleSku(sku)"
                  >
                    {{ sku.isActive ? '● 已上架' : '○ 已下架' }}
                  </button>
                  <span class="catalog-row-actions"
                    ><button class="catalog-btn red small" @click="confirmDeleteSku(sku)">
                      删除</button
                    ><button class="catalog-btn ghost small" @click="openExamples(sku)">
                      示例图</button
                    ><button class="catalog-btn ghost small" @click="openBom(sku)">
                      材料清单
                    </button></span
                  >
                </div>
              </div>
              <div class="catalog-card-actions">
                <button class="catalog-btn ghost small" @click="openSort('sku', model)">
                  ↕ 调整SKU顺序</button
                ><button class="catalog-btn ghost small" @click="openSku(model)">
                  ＋ 新增 SKU
                </button>
              </div>
            </div>
          </article>
        </div>
      </div>
    </main>

    <div v-if="modal" class="catalog-overlay" @mousedown.self="closeModal">
      <form v-if="modal === 'model'" class="catalog-modal" @submit.prevent="submitModel">
        <h2>{{ selectedModel ? '编辑款式' : '新增款式' }}</h2>
        <p>款式基本信息，SKU规格在款式创建后单独添加</p>
        <label>款式名称 <em>必填</em><input v-model="modelForm.name" /></label>
        <label>款式介绍 <em>必填</em><textarea v-model="modelForm.description"></textarea></label>
        <label
          >展示图片URL <em>选填</em
          ><input v-model="modelForm.previewImage" placeholder="https://..."
        /></label>
        <label
          >介绍视频URL <em>选填</em><input v-model="modelForm.videoUrl" placeholder="https://..."
        /></label>
        <label
          >款式类型<select v-model="modelForm.modelType">
            <option value="single">普通款（单动画）</option>
            <option value="dual">双动画款（上下分屏）</option>
            <option value="panorama">全景款</option>
          </select></label
        >
        <div class="catalog-modal-actions">
          <button class="catalog-btn ghost" type="button" @click="closeModal">取消</button
          ><button class="catalog-btn black" :disabled="busy">保存款式</button>
        </div>
      </form>

      <form
        v-else-if="modal === 'sku'"
        class="catalog-modal catalog-sku-modal"
        @submit.prevent="submitSku"
      >
        <h2>新增 SKU</h2>
        <p>款式：{{ selectedModel?.name }}</p>
        <div class="catalog-form-grid">
          <label
            >尺寸 <em>必填</em
            ><select v-model="skuForm.size">
              <option value="">请选择</option>
              <option v-for="item in sizes" :key="item">{{ item }}</option></select
            ><span class="catalog-option-edit"
              ><input v-model="optionDraft.size" placeholder="新增尺寸" /><button
                type="button"
                @click="addOption('size')"
              >
                ＋</button
              ><button v-if="skuForm.size" type="button" @click="removeSelectedOption('size')">
                −
              </button></span
            ></label
          >
          <label
            >材质 <em>必填</em
            ><select v-model="skuForm.material">
              <option value="">请选择</option>
              <option v-for="item in materials" :key="item">{{ item }}</option></select
            ><span class="catalog-option-edit"
              ><input v-model="optionDraft.material" placeholder="新增材质" /><button
                type="button"
                @click="addOption('material')"
              >
                ＋</button
              ><button
                v-if="skuForm.material"
                type="button"
                @click="removeSelectedOption('material')"
              >
                −
              </button></span
            ></label
          >
        </div>
        <label
          >帧数 <em>必填</em
          ><select v-model="skuForm.frameCount">
            <option value="">请选择</option>
            <option v-for="item in frames" :key="item" :value="String(item)">
              {{ item }} 帧
            </option></select
          ><span class="catalog-option-edit"
            ><input v-model="optionDraft.frame" type="number" placeholder="新增帧数" /><button
              type="button"
              @click="addOption('frame')"
            >
              ＋</button
            ><button v-if="skuForm.frameCount" type="button" @click="removeSelectedOption('frame')">
              −
            </button></span
          ></label
        >
        <label
          >价格 <em>必填，单位：元</em><input v-model="skuForm.price" type="number" min="0"
        /></label>
        <label
          >颜色 <em>必填</em
          ><select v-model="skuForm.colorName" @change="chooseColor">
            <option value="">请选择</option>
            <option v-for="item in colors" :key="item.name">{{ item.name }}</option></select
          ><span class="catalog-option-edit"
            ><input v-model="optionDraft.colorName" placeholder="新增颜色" /><input
              v-model="optionDraft.colorHex"
              type="color"
            /><button type="button" @click="addOption('color')">＋</button
            ><button v-if="skuForm.colorName" type="button" @click="removeSelectedOption('color')">
              −
            </button></span
          ></label
        >
        <div class="catalog-modal-actions">
          <button class="catalog-btn ghost" type="button" @click="closeModal">取消</button
          ><button class="catalog-btn black" :disabled="busy">保存此 SKU</button>
        </div>
      </form>

      <div v-else-if="modal === 'delete-model'" class="catalog-modal compact-modal">
        <h2>确认删除款式</h2>
        <p>
          {{
            selectedModel?.skus.length
              ? `「${selectedModel.name}」下还有 ${selectedModel.skus.length} 个SKU，请先删除所有SKU再删除款式`
              : `确认删除款式「${selectedModel?.name}」？此操作不可恢复`
          }}
        </p>
        <div class="catalog-modal-actions">
          <button class="catalog-btn ghost" @click="closeModal">取消</button
          ><button class="catalog-btn red" :disabled="busy" @click="removeModel">确认删除</button>
        </div>
      </div>
      <div v-else-if="modal === 'delete-sku'" class="catalog-modal compact-modal">
        <h2>确认删除 SKU</h2>
        <p>
          确认删除：{{ selectedSku?.size }}·{{ selectedSku?.material }}·{{
            selectedSku?.frameCount
          }}帧·{{ selectedSku?.colorName }}？此操作不可恢复，同时删除库存记录。
        </p>
        <div class="catalog-modal-actions">
          <button class="catalog-btn ghost" @click="closeModal">取消</button
          ><button class="catalog-btn red" :disabled="busy" @click="removeSku">确认删除</button>
        </div>
      </div>

      <div v-else-if="modal === 'sort'" class="catalog-modal sort-modal">
        <h2>调整{{ sortMode === 'model' ? '款式' : 'SKU' }}顺序</h2>
        <p>拖拽或点击上下箭头调整，顺序决定生产导出优先级</p>
        <div class="catalog-sort-list">
          <div
            v-for="(item, index) in sortItems"
            :key="item.id"
            class="catalog-sort-item"
            :class="{ dragging: dragIndex === index }"
            draggable="true"
            @dragstart="startSortDrag(index)"
            @dragover.prevent
            @drop="dropSort(index)"
            @dragend="dragIndex = null"
          >
            <span class="catalog-sort-handle" aria-hidden="true">⠿</span>
            <b>{{ index + 1 }}</b
            ><span
              ><strong>{{ item.name }}</strong
              ><small>{{ item.sub }}</small></span
            ><i
              ><button :disabled="index === 0" @click="moveSort(index, -1)">▲</button
              ><button :disabled="index === sortItems.length - 1" @click="moveSort(index, 1)">
                ▼
              </button></i
            >
          </div>
        </div>
        <div class="catalog-modal-actions">
          <button class="catalog-btn ghost" @click="closeModal">取消</button
          ><button class="catalog-btn black" :disabled="busy" @click="submitSort">保存顺序</button>
        </div>
      </div>

      <div v-else-if="modal === 'examples'" class="catalog-modal examples-modal">
        <h2>
          示例图 — {{ selectedSku?.size }}·{{ selectedSku?.material }}·{{
            selectedSku?.frameCount
          }}帧
        </h2>
        <p>最多上传 5 张，每张不超过 5MB</p>
        <div v-if="exampleLoading" class="catalog-empty compact">加载中…</div>
        <div v-else-if="!examples.length" class="catalog-empty compact">
          暂无示例图，点击“上传示例图”添加
        </div>
        <div v-else class="catalog-example-grid">
          <figure v-for="item in examples" :key="item.key">
            <img v-if="safeReviewImage(item.url)" :src="safeReviewImage(item.url)!" alt="" /><span
              v-else
              >预览失效</span
            ><button :disabled="busy" @click="removeExample(item)">×</button>
          </figure>
        </div>
        <div class="catalog-modal-actions">
          <button class="catalog-btn ghost" @click="closeModal">关闭</button
          ><label class="catalog-btn black" :class="{ disabled: busy || examples.length >= 5 }"
            >上传示例图<input
              type="file"
              accept="image/*"
              :disabled="busy || examples.length >= 5"
              @change="uploadExample"
          /></label>
        </div>
      </div>

      <div v-else-if="modal === 'bom'" class="catalog-modal bom-modal">
        <h2>材料清单</h2>
        <p>
          {{ selectedSku?.size }} · {{ selectedSku?.material }} · {{ selectedSku?.frameCount }}帧
        </p>
        <input
          v-model="bomSearch"
          class="catalog-search"
          type="search"
          placeholder="搜索零件名称、编码或规格"
        />
        <div v-if="bomLoading" class="catalog-empty compact">正在加载…</div>
        <div v-else-if="!filteredMaterials.length" class="catalog-empty compact">
          没有找到零件，请先到库存管理建立
        </div>
        <div v-else class="catalog-material-list">
          <label v-for="item in filteredMaterials" :key="item.id"
            ><input
              type="checkbox"
              :checked="bomSelected.has(item.id)"
              @change="toggleBom(item, ($event.target as HTMLInputElement).checked)"
            /><span
              ><b>{{ item.name }}</b
              ><small
                >{{ item.specification || item.itemType
                }}{{ item.itemCode ? ` · ${item.itemCode}` : '' }} · 库存 {{ item.currentStock
                }}{{ item.unit }}</small
              ></span
            ><span
              ><input
                type="number"
                min="1"
                :disabled="!bomSelected.has(item.id)"
                :value="bomSelected.get(item.id) || 1"
                @change="setBomQty(item.id, ($event.target as HTMLInputElement).value)"
              />{{ item.unit }}/套</span
            ></label
          >
        </div>
        <div class="catalog-modal-actions">
          <button class="catalog-btn ghost" @click="closeModal">取消</button
          ><button class="catalog-btn black" :disabled="busy || bomLoading" @click="submitBom">
            保存材料清单
          </button>
        </div>
      </div>
    </div>
    <div v-if="notice" class="catalog-toast" role="status">{{ notice }}</div>
  </div>
</template>
