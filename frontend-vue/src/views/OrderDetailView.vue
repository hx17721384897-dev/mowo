<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  cancelOrder,
  confirmOrderReceipt,
  createAftersaleRequest,
  getAftersaleRequest,
  getOrder
} from '@/features/transaction/api'
import OrderProgress from '@/features/transaction/OrderProgress.vue'
import {
  AFTERSALE_REASONS,
  AFTERSALE_STATUS_LABEL,
  ORDER_STATUS_ICON,
  orderEta,
  orderProgressVisible
} from '@/features/transaction/order-presentation'
import type {
  AftersaleRequestDto,
  AftersaleType,
  OrderViewModel
} from '@/features/transaction/types'
import { toOrderViewModel } from '@/features/transaction/view-model'
import { uploadRegisteredPrivateFile } from '@/services/private-upload'
import '@/features/transaction/orders.css'

const route = useRoute()
const order = ref<OrderViewModel | null>(null)
const loading = ref(true)
const error = ref('')
const toast = ref('')
const dialog = ref<'cancel' | 'receipt' | 'aftersale' | 'status' | null>(null)
const busy = ref(false)
const uploading = ref(false)
const aftersale = ref<AftersaleRequestDto | null>(null)
const aftersaleError = ref('')
const aftersaleType = ref<AftersaleType | null>(null)
const reason = ref('')
const description = ref('')
const images = ref<{ key: string; url: string }[]>([])
let sequence = 0
let toastTimer: ReturnType<typeof setTimeout> | undefined

const orderId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))
const canRequestAftersale = computed(
  () =>
    !!order.value && (order.value.actions.canRequestRefund || order.value.actions.canRequestQuality)
)
const reasons = computed(() => (aftersaleType.value ? AFTERSALE_REASONS[aftersaleType.value] : []))

function notify(message: string): void {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, 3000)
}

async function load(): Promise<void> {
  const request = ++sequence
  loading.value = true
  error.value = ''
  order.value = null
  if (!orderId.value) {
    error.value = '缺少订单 ID'
    loading.value = false
    return
  }
  try {
    const result = toOrderViewModel(await getOrder(orderId.value))
    if (request === sequence) order.value = result
  } catch (cause) {
    if (request === sequence) error.value = cause instanceof Error ? cause.message : '订单加载失败'
  } finally {
    if (request === sequence) loading.value = false
  }
}

function closeDialog(): void {
  if (busy.value || uploading.value) return
  dialog.value = null
  for (const image of images.value) URL.revokeObjectURL(image.url)
  images.value = []
}

function openAftersale(): void {
  if (!canRequestAftersale.value) return
  aftersaleType.value = null
  reason.value = ''
  description.value = ''
  images.value = []
  dialog.value = 'aftersale'
}

function pickType(value: AftersaleType): void {
  if (
    uploading.value ||
    !order.value ||
    !order.value.actions[value === 'refund' ? 'canRequestRefund' : 'canRequestQuality']
  )
    return
  aftersaleType.value = value
  reason.value = ''
  if (value !== 'quality') {
    for (const image of images.value) URL.revokeObjectURL(image.url)
    images.value = []
  }
}

async function uploadImages(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (uploading.value || images.value.length >= 3 || !files.length) return
  uploading.value = true
  try {
    for (const file of files.slice(0, 3 - images.value.length)) {
      if (
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 10 * 1024 * 1024 ||
        file.size === 0
      ) {
        notify('仅支持 JPG / PNG / WebP，每张限 10MB')
        continue
      }
      const key = await uploadRegisteredPrivateFile(file, 'AFTERSALE_EVIDENCE')
      images.value.push({ key, url: URL.createObjectURL(file) })
    }
  } catch (cause) {
    notify(cause instanceof Error ? cause.message : '图片上传失败')
  } finally {
    uploading.value = false
  }
}

async function executeAction(): Promise<void> {
  const current = order.value
  const action = dialog.value
  if (!current || busy.value || !action) return
  if (action === 'cancel' && !current.actions.canCancel) return
  if (action === 'receipt' && !current.actions.canConfirmReceipt) return
  if (action === 'aftersale' && (!aftersaleType.value || !reason.value || uploading.value)) {
    notify('请选择申请类型和原因')
    return
  }
  if (
    action === 'aftersale' &&
    !current.actions[aftersaleType.value === 'refund' ? 'canRequestRefund' : 'canRequestQuality']
  )
    return
  busy.value = true
  try {
    if (action === 'cancel') await cancelOrder(current.id)
    else if (action === 'receipt') await confirmOrderReceipt(current.id)
    else if (action === 'aftersale')
      await createAftersaleRequest(current.id, {
        type: aftersaleType.value!,
        reason: reason.value,
        description: description.value.trim() || undefined,
        imageUrls: aftersaleType.value === 'quality' ? images.value.map((image) => image.key) : []
      })
    else return
    dialog.value = null
    for (const image of images.value) URL.revokeObjectURL(image.url)
    images.value = []
    notify(
      action === 'aftersale'
        ? '✓ 售后申请已提交'
        : action === 'receipt'
          ? '✓ 已确认收货'
          : '✓ 订单已取消'
    )
    await load()
  } catch (cause) {
    notify(cause instanceof Error ? cause.message : '操作失败，请稍后重试')
  } finally {
    busy.value = false
  }
}

async function showAftersaleStatus(): Promise<void> {
  if (!order.value) return
  dialog.value = 'status'
  aftersale.value = null
  aftersaleError.value = ''
  busy.value = true
  try {
    aftersale.value = await getAftersaleRequest(order.value.id)
  } catch (cause) {
    aftersaleError.value = cause instanceof Error ? cause.message : '加载失败，请重试'
  } finally {
    busy.value = false
  }
}

async function copyTracking(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    notify('✓ 快递单号已复制')
  } catch {
    notify(`快递单号：${value}`)
  }
}

watch(orderId, () => {
  closeDialog()
  load()
})
onMounted(() => load())
onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer)
  for (const image of images.value) URL.revokeObjectURL(image.url)
})
</script>

<template>
  <main class="orders-page order-detail-page">
    <RouterLink :to="{ name: 'orders' }" class="back-link">← 返回我的订单</RouterLink>
    <section class="status-hero">
      <div v-if="loading" aria-live="polite">
        <div class="sk" style="width: 160px; height: 24px; margin-bottom: 20px"></div>
        <div class="sk" style="height: 50px"></div>
      </div>
      <div v-else-if="error" class="hero-error">
        <div class="hero-icon">😔</div>
        <h1>加载失败</h1>
        <p>{{ error }}</p>
        <button class="btn-action yellow" @click="load">重新加载</button>
      </div>
      <template v-else-if="order"
        ><div class="hero-top">
          <div>
            <div class="hero-status-label">订单状态</div>
            <h1 class="hero-status-val">{{ order.displayStatus }}</h1>
            <div class="hero-order-no">
              {{ order.kind === 'pre_order' ? '付款前编号' : 'NO.' }} {{ order.orderNo }}
            </div>
          </div>
          <div class="hero-icon">{{ ORDER_STATUS_ICON[order.status] }}</div>
        </div>
        <OrderProgress v-if="orderProgressVisible(order)" :order="order" hero /><button
          v-if="order.status === 'shipped' && order.trackingNo"
          class="hero-eta"
          @click="copyTracking(order.trackingNo)"
        >
          <span>📦</span
          ><span
            >{{ order.trackingCompany || '快递' }} {{ order.trackingNo
            }}<small>点击复制快递单号</small></span
          >
        </button>
        <div v-else-if="orderEta(order)" class="hero-eta">🔧 {{ orderEta(order) }}</div>
        <div
          v-else-if="order.kind === 'pre_order' && order.status === 'pending' && order.expiresAt"
          class="hero-eta"
        >
          ⏳ 付款截止：{{ new Date(order.expiresAt).toLocaleString('zh-CN', { hour12: false }) }}
        </div></template
      >
    </section>
    <template v-if="order">
      <section class="order-section">
        <div class="sec-head"><h2>🎨 商品明细</h2></div>
        <div v-for="item in order.items" :key="item.id" class="order-item">
          <div class="oi-cover">
            <img v-if="item.coverUrl" :src="item.coverUrl" alt="" /><span v-else>{{
              item.itemType === 'MARKET' ? '🎬' : '🎨'
            }}</span>
          </div>
          <div class="oi-info">
            <div class="oi-title">{{ item.productTitle }}</div>
            <div class="oi-machine">⚙ {{ item.specificationText }}</div>
            <div class="oi-qty">数量：{{ item.quantity }}</div>
          </div>
          <div class="oi-price">{{ item.lineTotalText }}</div>
        </div>
      </section>
      <section class="order-section">
        <div class="sec-head"><h2>📍 收货地址</h2></div>
        <div v-if="order.receiverName" class="address-block">
          <div class="addr-name">{{ order.receiverName }}</div>
          <div class="addr-phone">{{ order.receiverPhoneMasked }}</div>
          <div class="addr-full">{{ order.receiverAddressText || '—' }}</div>
        </div>
        <div v-else class="address-block">暂无收货地址信息</div>
      </section>
      <section class="order-section">
        <div class="sec-head"><h2>💳 支付信息</h2></div>
        <div class="info-row">
          <span>商品合计</span><strong>{{ order.totalAmountText }}</strong>
        </div>
        <div class="info-row"><span>运费</span><strong>包邮</strong></div>
        <div class="info-row">
          <span>下单时间</span><strong>{{ order.createdAtText }}</strong>
        </div>
        <div class="info-row">
          <span>{{ order.kind === 'pre_order' ? '待付金额' : '实付金额' }}</span
          ><strong class="total">{{ order.totalAmountText }}</strong>
        </div>
      </section>
      <section class="action-bar">
        <h2>操作</h2>
        <div class="action-btns">
          <RouterLink
            v-if="
              order.kind === 'pre_order' && order.status === 'pending' && order.actions.canCancel
            "
            class="btn-action yellow"
            :to="{ name: 'checkout', query: { preOrderId: order.id.slice(4) } }"
            >继续付款</RouterLink
          >
          <button
            v-if="order.actions.canConfirmReceipt"
            class="btn-action yellow"
            @click="dialog = 'receipt'"
          >
            确认收货</button
          ><RouterLink to="/contact" class="btn-action outline">联系客服</RouterLink
          ><button
            v-if="order.actions.canCancel"
            class="btn-action danger"
            @click="dialog = 'cancel'"
          >
            取消订单</button
          ><button v-if="canRequestAftersale" class="btn-action danger" @click="openAftersale">
            申请售后</button
          ><button
            v-if="order.status === 'aftersale'"
            class="btn-action primary"
            @click="showAftersaleStatus"
          >
            查看售后进度
          </button>
        </div>
      </section>
    </template>
    <div v-if="dialog" class="order-modal-bg" @click.self="closeDialog">
      <div
        class="order-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="
          dialog === 'aftersale'
            ? '申请售后'
            : dialog === 'status'
              ? '售后申请进度'
              : dialog === 'cancel'
                ? '取消订单'
                : '确认收货'
        "
      >
        <template v-if="dialog === 'cancel' || dialog === 'receipt'"
          ><div class="modal-icon">{{ dialog === 'cancel' ? '❌' : '📦' }}</div>
          <h2>{{ dialog === 'cancel' ? '确认取消此订单？' : '确认已收到商品？' }}</h2>
          <p>
            {{
              dialog === 'cancel'
                ? order?.kind === 'pre_order'
                  ? '取消后已预留的库存会释放；这笔订单尚未付款。'
                  : '取消后不可恢复，如有疑问请先联系客服。'
                : '确认后订单将进入已完成状态。'
            }}
          </p>
          <div class="modal-buttons">
            <button :disabled="busy" @click="closeDialog">返回</button
            ><button class="strong" :disabled="busy" @click="executeAction">
              {{ busy ? '处理中…' : '确认' }}
            </button>
          </div></template
        >
        <template v-else-if="dialog === 'aftersale'"
          ><div class="modal-icon">🔄</div>
          <h2>申请售后</h2>
          <p>请选择申请类型和原因，我们会根据订单状态处理申请。</p>
          <div class="type-btns">
            <button
              :disabled="!order?.actions.canRequestRefund"
              :class="{ sel: aftersaleType === 'refund' }"
              @click="pickType('refund')"
            >
              💸 退款申请</button
            ><button
              :disabled="!order?.actions.canRequestQuality"
              :class="{ sel: aftersaleType === 'quality' }"
              @click="pickType('quality')"
            >
              🔧 质量售后
            </button>
          </div>
          <div v-if="aftersaleType" class="reason-list">
            <button
              v-for="value in reasons"
              :key="value"
              :class="{ sel: reason === value }"
              @click="reason = value"
            >
              <span class="reason-radio"></span>{{ value }}
            </button>
          </div>
          <textarea
            v-if="aftersaleType"
            v-model="description"
            maxlength="300"
            class="modal-textarea"
            placeholder="请详细描述问题，有助于我们处理（选填）"
          ></textarea>
          <div v-if="aftersaleType === 'quality'" class="img-upload-area">
            <strong>上传凭证图片（最多 3 张）</strong>
            <div class="img-upload-row">
              <img
                v-for="image in images"
                :key="image.key"
                :src="image.url"
                alt="已上传凭证"
                class="img-thumb"
              /><label v-if="images.length < 3" class="img-add-btn" :class="{ disabled: uploading }"
                >＋<input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  :disabled="uploading"
                  @change="uploadImages"
              /></label>
            </div>
            <small>仅支持 JPG / PNG / WebP，每张限 10MB</small>
          </div>
          <div class="modal-legal">
            售后申请以实际订单情况和客服审核结果为准；如有疑问请联系客服。
          </div>
          <div class="modal-buttons">
            <button :disabled="busy || uploading" @click="closeDialog">取消</button
            ><button class="strong" :disabled="busy || uploading || !reason" @click="executeAction">
              {{ busy ? '提交中…' : uploading ? '上传中…' : '提交申请' }}
            </button>
          </div></template
        >
        <template v-else
          ><div class="modal-icon">🔄</div>
          <h2>售后申请进度</h2>
          <p v-if="busy">加载中…</p>
          <p v-else-if="aftersaleError" role="alert">{{ aftersaleError }}</p>
          <p v-else-if="!aftersale">暂无售后申请记录</p>
          <div v-else class="aftersale-status">
            <div>
              <strong>{{ aftersale.type === 'refund' ? '退款申请' : '质量售后' }}</strong>
              <span class="aftersale-tag" :class="aftersale.status">{{
                AFTERSALE_STATUS_LABEL[aftersale.status]
              }}</span>
            </div>
            <p>📌 原因：{{ aftersale.reason }}</p>
            <p v-if="aftersale.description">{{ aftersale.description }}</p>
            <small>申请时间：{{ new Date(aftersale.createdAt).toLocaleString('zh-CN') }}</small>
            <div v-if="aftersale.adminNote" class="aftersale-note-box">
              <strong>客服回复</strong>
              <p>{{ aftersale.adminNote }}</p>
              <small v-if="aftersale.processedAt"
                >处理时间：{{ new Date(aftersale.processedAt).toLocaleString('zh-CN') }}</small
              >
            </div>
          </div>
          <div class="modal-buttons"><button @click="closeDialog">关闭</button></div></template
        >
      </div>
    </div>
    <div v-if="toast" class="order-toast" role="status">{{ toast }}</div>
  </main>
</template>
