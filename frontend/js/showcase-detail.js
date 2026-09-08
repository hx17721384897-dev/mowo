const DETAIL_API = window.MOWO_API_BASE
const PURCHASE_KEY = 'mowo_pending_purchase'
const VISITOR_KEY = 'mowo_storefront_visitor'
const workId = new URLSearchParams(location.search).get('workId')
let work = null
let selectedSku = null
let quantity = 1
let slides = []
let currentSlide = 0
const framePlayer = { frames: [], index: 0, timer: null, fps: 10 }

document.addEventListener('DOMContentLoaded', initDetail)
window.addEventListener('mowoLoginCompleted', resumePendingPurchase)

async function initDetail() {
  if (!workId) return renderError('缺少商品编号，请返回联名作品列表重新选择')
  try {
    const response = await fetch(`${DETAIL_API}/api/collab/works/${encodeURIComponent(workId)}`)
    const json = await parseApiJson(response, '商品详情暂时无法加载，请稍后重试')
    if (!response.ok || !json.success) throw new Error(json.message || '商品不存在或已经下架')
    work = json.data
    selectedSku = work.supportedSkus?.[0] || null
    renderProduct()
    scheduleValidView()
    await loadMoreProducts()
  } catch (error) {
    renderError(error.message)
  }
}

function renderProduct() {
  const root = document.getElementById('productRoot')
  const creator = work.creator || {}
  const creatorName = creator.nickname || '创作者'
  const avatar = creator.avatarUrl
    ? `<img src="${escapeHtml(creator.avatarUrl)}" alt="${escapeHtml(creatorName)}">`
    : escapeHtml(creatorName.charAt(0))
  const tags = (work.storefrontTags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')
  slides = buildSlides(work)
  framePlayer.frames = Array.isArray(work.animationFrames) ? work.animationFrames.filter(Boolean) : []
  framePlayer.index = 0
  currentSlide = 0
  root.innerHTML = `<div class="product">
    <section class="gallery" aria-label="商品素材">
      <div class="stage" id="galleryStage">${renderSlides()}
        <button class="gallery-arrow prev" onclick="moveSlide(-1)" aria-label="上一张" ${slides.length <= 1 ? 'hidden' : ''}>&lsaquo;</button>
        <button class="gallery-arrow next" onclick="moveSlide(1)" aria-label="下一张" ${slides.length <= 1 ? 'hidden' : ''}>&rsaquo;</button>
        <span class="counter" id="galleryCounter">1 / ${Math.max(1, slides.length)}</span>
      </div>
      <div class="thumbs">${slides.map((slide, index) => renderThumb(slide, index)).join('')}</div>
    </section>
    <section class="info">
      <div class="series">${escapeHtml(work.storefrontSeries || '哞屋联名作品')}</div>
      <h1 class="title">${escapeHtml(work.title)}</h1>
      <p class="summary">${escapeHtml(work.storefrontSummary || '')}</p>
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      <a class="creator" href="showcase.html?creatorId=${encodeURIComponent(work.creatorId)}"><div class="creator-avatar">${avatar}</div><div><div class="creator-label">联名创作者</div><div class="creator-name">${escapeHtml(creatorName)}</div></div></a>
      <div class="price-line"><span class="price" id="mainPrice">${formatPrice(selectedSku?.finalPrice)}</span><span class="price-note">按所选款式计价</span></div>
      <div class="section-label">选择完整款式</div>
      <div class="sku-list">${(work.supportedSkus || []).map(renderSku).join('')}</div>
      <div class="quantity"><b>数量</b><div class="stepper"><button onclick="changeQuantity(-1)" aria-label="减少数量">-</button><input id="quantityInput" value="1" inputmode="numeric" onchange="setQuantity(this.value)" aria-label="购买数量"><button onclick="changeQuantity(1)" aria-label="增加数量">+</button></div></div>
      <div class="actions"><button class="action cart" onclick="requestPurchase('cart')">加入购物车</button><button class="action buy" onclick="requestPurchase('buy')">立即购买</button></div>
      <div class="selection-hint" id="selectionHint"></div>
    </section>
  </div>`
  document.title = `${work.title} - 哞屋 MOWO`
  document.getElementById('crumbTitle').textContent = work.title
  document.getElementById('detailCopy').textContent = work.description || ''
  document.getElementById('detailBand').hidden = false
  document.getElementById('purchaseBar').hidden = false
  document.getElementById('barTitle').textContent = work.title
  bindGalleryImageFallbacks(root)
  updateSelection()
  renderSpecTable()
}

function bindGalleryImageFallbacks(root) {
  root.querySelectorAll('.slide img').forEach(image => {
    image.addEventListener('error', () => {
      const message = document.createElement('strong')
      message.textContent = '该素材暂时不可用'
      image.replaceWith(message)
    }, { once: true })
  })
}

async function parseApiJson(response, fallbackMessage) {
  try {
    return await response.json()
  } catch {
    throw new Error(fallbackMessage)
  }
}

function buildSlides(product) {
  const result = []
  const seen = new Set()
  const add = slide => {
    const key = slide.url || slide.type
    if (!key || seen.has(key)) return
    seen.add(key)
    result.push(slide)
  }
  if (product.coverUrl) add({ type: 'image', url: product.coverUrl, label: '商品封面' })
  for (const item of product.storefrontMedia || []) {
    if (typeof item === 'string') add({ type: 'image', url: item, label: '商品素材' })
    else add({ type: item.kind === 'video' ? 'video' : 'image', url: item.url, label: '商品素材' })
  }
  if (product.animationFrames?.length) add({ type: 'player', label: '动画预览' })
  return result.length ? result : [{ type: 'empty', label: '暂无素材' }]
}

function renderSlides() {
  return slides.map((slide, index) => {
    const active = index === 0 ? ' active' : ''
    if (slide.type === 'video') return `<div class="slide${active}" data-slide="${index}"><video src="${escapeHtml(slide.url)}" controls playsinline preload="metadata"></video></div>`
    if (slide.type === 'player') return `<div class="slide${active}" data-slide="${index}"><div class="frame-player"><img id="frameImage" src="${escapeHtml(framePlayer.frames[0] || '')}" alt="动画预览"><div class="player-tools"><span class="player-meta">${framePlayer.frames.length} 个核心帧 · <span id="fpsValue">${framePlayer.fps}</span> fps</span><div><button onclick="changeFps(-2)" aria-label="减慢播放">-</button><button id="playButton" onclick="toggleFrames()" aria-label="播放动画">播放</button><button onclick="changeFps(2)" aria-label="加快播放">+</button></div></div></div></div>`
    if (slide.type === 'image') return `<div class="slide${active}" data-slide="${index}"><img src="${escapeHtml(slide.url)}" alt="${escapeHtml(slide.label)}"></div>`
    return `<div class="slide${active}" data-slide="${index}"><strong>暂无商品素材</strong></div>`
  }).join('')
}

function renderThumb(slide, index) {
  if (slide.type === 'image') return `<button class="thumb${index === 0 ? ' active' : ''}" onclick="goSlide(${index})" aria-label="${escapeHtml(slide.label)}"><img src="${escapeHtml(slide.url)}" alt=""></button>`
  return `<button class="thumb${index === 0 ? ' active' : ''}" onclick="goSlide(${index})" aria-label="${escapeHtml(slide.label)}"><span>${slide.type === 'video' ? '视频' : slide.type === 'player' ? '动画' : '暂无'}</span></button>`
}

function renderSku(sku) {
  const selected = selectedSku?.id === sku.id
  const image = sku.previewImage ? `<img src="${escapeHtml(sku.previewImage)}" alt="">` : '暂无图'
  const fulfillment = sku.fulfillmentMode === 'STOCK_ONLY' ? '库存款' : '可安排制作'
  return `<button class="sku-card${selected ? ' selected' : ''}" data-sku-id="${escapeHtml(sku.id)}" onclick="selectSku('${escapeJs(sku.id)}')">
    <span class="sku-image">${image}</span><span><span class="sku-name">${escapeHtml(sku.modelName)} · ${escapeHtml(sku.size)} · ${sku.frameCount}帧</span><span class="sku-meta">${escapeHtml(sku.material)} · <span class="swatch" style="background:${safeColor(sku.colorHex)}"></span>${escapeHtml(sku.colorName || '默认颜色')}</span><span class="sku-delivery">${fulfillment} · 预计 ${sku.leadTimeDays} 天内发出</span></span><span class="sku-price">${formatPrice(sku.finalPrice)}</span>
  </button>`
}

function selectSku(id) {
  selectedSku = work.supportedSkus.find(sku => sku.id === id) || null
  document.querySelectorAll('.sku-card').forEach(card => card.classList.toggle('selected', card.dataset.skuId === id))
  updateSelection()
  renderSpecTable()
}

function updateSelection() {
  const hint = document.getElementById('selectionHint')
  if (!selectedSku) {
    if (hint) hint.textContent = '请选择一个可购买款式'
    return
  }
  if (hint) hint.textContent = ''
  const choice = `${selectedSku.modelName} · ${selectedSku.size} · ${selectedSku.frameCount}帧 · ${selectedSku.material} · ${selectedSku.colorName || '默认颜色'}`
  document.getElementById('mainPrice').textContent = formatPrice(selectedSku.finalPrice)
  document.getElementById('barPrice').textContent = formatPrice(selectedSku.finalPrice)
  document.getElementById('barChoice').textContent = `${choice} · ${quantity} 件`
}

function renderSpecTable() {
  if (!selectedSku) return
  const fulfillment = selectedSku.fulfillmentMode === 'STOCK_ONLY' ? '仅限现货' : '库存优先，无库存时安排制作'
  document.getElementById('specTable').innerHTML = [
    ['款式', selectedSku.modelName], ['尺寸', selectedSku.size], ['产品帧数', `${selectedSku.frameCount} 帧`],
    ['材质', selectedSku.material], ['颜色', selectedSku.colorName || '默认颜色'], ['供货方式', fulfillment],
    ['预计发出', `${selectedSku.leadTimeDays} 天内`]
  ].map(([key, value]) => `<div class="spec-row"><span class="spec-key">${escapeHtml(key)}</span><span class="spec-value">${escapeHtml(value)}</span></div>`).join('')
}

function changeQuantity(delta) { setQuantity(quantity + delta) }
function setQuantity(value) {
  quantity = Math.max(1, Math.min(10, Number.parseInt(value, 10) || 1))
  const input = document.getElementById('quantityInput')
  if (input) input.value = quantity
  updateSelection()
}

function goSlide(index) {
  stopFrames()
  currentSlide = (index + slides.length) % slides.length
  document.querySelectorAll('.slide').forEach((slide, i) => slide.classList.toggle('active', i === currentSlide))
  document.querySelectorAll('.thumb').forEach((thumb, i) => thumb.classList.toggle('active', i === currentSlide))
  document.getElementById('galleryCounter').textContent = `${currentSlide + 1} / ${slides.length}`
}
function moveSlide(delta) { goSlide(currentSlide + delta) }
function toggleFrames() { framePlayer.timer ? stopFrames() : startFrames() }
function startFrames() {
  if (!framePlayer.frames.length) return
  stopFrames()
  framePlayer.timer = setInterval(() => {
    framePlayer.index = (framePlayer.index + 1) % framePlayer.frames.length
    const image = document.getElementById('frameImage')
    if (image) image.src = framePlayer.frames[framePlayer.index]
  }, Math.round(1000 / framePlayer.fps))
  const button = document.getElementById('playButton')
  if (button) button.textContent = '暂停'
}
function stopFrames() {
  clearInterval(framePlayer.timer)
  framePlayer.timer = null
  const button = document.getElementById('playButton')
  if (button) button.textContent = '播放'
}
function changeFps(delta) {
  framePlayer.fps = Math.max(2, Math.min(20, framePlayer.fps + delta))
  const label = document.getElementById('fpsValue')
  if (label) label.textContent = framePlayer.fps
  if (framePlayer.timer) startFrames()
}

async function requestPurchase(action) {
  if (!selectedSku) return showDetailToast('请先选择一个款式')
  const intent = { workId, skuId: selectedSku.id, quantity, action, createdAt: Date.now() }
  const token = localStorage.getItem('mowo_token')
  if (!token) {
    localStorage.setItem(PURCHASE_KEY, JSON.stringify(intent))
    showDetailToast('登录后将继续本次操作')
    window.openAuthModal?.()
    return
  }
  await executePurchase(intent)
}

async function resumePendingPurchase() {
  const intent = readPendingPurchase()
  if (!intent || intent.workId !== workId) return
  localStorage.removeItem(PURCHASE_KEY)
  await executePurchase(intent)
}

function readPendingPurchase() {
  try {
    const intent = JSON.parse(localStorage.getItem(PURCHASE_KEY) || 'null')
    if (!intent || Date.now() - intent.createdAt > 15 * 60 * 1000) {
      localStorage.removeItem(PURCHASE_KEY)
      return null
    }
    return intent
  } catch {
    localStorage.removeItem(PURCHASE_KEY)
    return null
  }
}

async function executePurchase(intent) {
  const token = localStorage.getItem('mowo_token')
  if (!token) return
  setPurchaseDisabled(true)
  try {
    const response = await fetch(`${DETAIL_API}/api/cart/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ itemType: 'MARKET', contentId: intent.workId, hardwareSkuId: intent.skuId, quantity: intent.quantity }),
    })
    const json = await parseApiJson(response, '相关推荐暂时无法加载')
    if (!response.ok || !json.success) throw new Error(json.message || '商品状态已变化，请重新确认')
    localStorage.removeItem(PURCHASE_KEY)
    if (intent.action === 'buy') {
      sessionStorage.setItem('mowo_checkout_items', JSON.stringify([json.data.id]))
      location.href = 'checkout.html'
      return
    }
    showDetailToast(json.merged ? '购物车数量已更新' : '已加入购物车')
  } catch (error) {
    showDetailToast(error.message)
  } finally {
    setPurchaseDisabled(false)
  }
}

function setPurchaseDisabled(disabled) { document.querySelectorAll('.action').forEach(button => { button.disabled = disabled }) }

async function loadMoreProducts() {
  try {
    const response = await fetch(`${DETAIL_API}/api/collab/works?page=1&limit=8`)
    const json = await response.json()
    const items = (json.data?.works || []).filter(item => item.id !== workId).slice(0, 4)
    if (!items.length) return
    document.getElementById('moreGrid').innerHTML = items.map(item => `<a class="more-card" href="showcase-detail.html?workId=${encodeURIComponent(item.id)}"><div class="more-image">${item.coverUrl ? `<img src="${escapeHtml(item.coverUrl)}" alt="">` : ''}</div><div class="more-body"><div class="more-title">${escapeHtml(item.title)}</div><div class="more-price">${formatPrice(item.minPrice)} 起</div></div></a>`).join('')
    document.getElementById('moreSection').hidden = false
  } catch {}
}

function getStorefrontVisitorId() {
  let visitorId = localStorage.getItem(VISITOR_KEY) || ''
  if (!/^[A-Za-z0-9._-]{16,100}$/.test(visitorId)) {
    visitorId = window.crypto?.randomUUID?.() || `visitor_${Date.now()}_${Math.random().toString(36).slice(2)}`
    localStorage.setItem(VISITOR_KEY, visitorId)
  }
  return visitorId
}

function scheduleValidView() {
  let visibleSince = document.visibilityState === 'visible' ? Date.now() : null
  let visibleMs = 0
  const timer = setInterval(async () => {
    const now = Date.now()
    if (document.visibilityState !== 'visible') {
      if (visibleSince !== null) visibleMs += now - visibleSince
      visibleSince = null
      return
    }
    if (visibleSince === null) visibleSince = now
    if (visibleMs + now - visibleSince < 3000) return
    clearInterval(timer)
    try {
      await fetch(`${DETAIL_API}/api/collab/works/${encodeURIComponent(workId)}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: getStorefrontVisitorId() }),
        keepalive: true,
      })
    } catch {}
  }, 500)
  setTimeout(() => clearInterval(timer), 30000)
}

function renderError(message) {
  document.getElementById('productRoot').innerHTML = `<div class="error-state"><strong>${escapeHtml(message)}</strong><a href="showcase.html">返回联名作品</a></div>`
}
function showDetailToast(message) {
  const toast = document.getElementById('detailToast')
  toast.textContent = message
  toast.classList.add('show')
  clearTimeout(showDetailToast.timer)
  showDetailToast.timer = setTimeout(() => toast.classList.remove('show'), 2600)
}
function formatPrice(value) { return Number.isFinite(Number(value)) ? `¥${Number(value).toFixed(2)}` : '暂不可售' }
function safeColor(value) { return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value || '') ? value : '#eee' }
function escapeJs(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'") }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]) }
