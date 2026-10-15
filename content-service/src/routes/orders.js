// routes/orders.js — 用户端订单查询、确认收货、取消订单
// 注册前缀：/api/orders

import { unlockInventoryInTransaction } from '../lib/inventory.js'
import { FILE_PURPOSE, findOwnedReadyFiles, linkFiles } from '../lib/private-files.js'
import { summarizeProductionStatus } from '../lib/sales-orders.js'
import { closePreOrderAndRelease, readCheckoutSnapshot } from '../lib/checkout-snapshot.js'

// 安全签名辅助：仅对 OSS key（相对路径）生成预签名 URL
// data URL（base64）和完整 http(s) URL 直接返回 null（不适合做缩略图）
function ossSign(fastify, value) {
  if (!value) return null
  if (value.startsWith('data:')) return null          // base64 data URL，跳过
  if (value.startsWith('http://') || value.startsWith('https://')) {
    // 已经是完整 URL，直接返回（通常不会出现，但做兜底）
    return value
  }
  // 相对 OSS key，生成预签名 URL（有效期 1 小时）
  try {
    return fastify.ossPresignGet(value, 3600)
  } catch {
    return null
  }
}

// 后端状态 → 前端展示映射
const STATUS_MAP = {
  pending:    { label: '待付款', group: 'pending',   step: 0 },
  paid:       { label: '已付款', group: 'paid',      step: 1 },
  locked:     { label: '制作中', group: 'making',    step: 2 },
  processing: { label: '制作中', group: 'making',    step: 2 },
  producing:  { label: '制作中', group: 'making',    step: 2 },
  shipped:    { label: '运输中', group: 'shipped',   step: 3 },
  received:   { label: '已完成', group: 'done',      step: 4 },
  aftersale:  { label: '售后中', group: 'aftersale', step: -1 },
  cancelled:  { label: '已取消', group: 'cancelled', step: -1 },
}

// 进行中的状态（active tab）
const ACTIVE_STATUSES = ['pending', 'paid', 'locked', 'processing', 'producing', 'shipped']
const ORDER_FILTERS = new Set(['all', 'pending', 'paid', 'producing', 'shipped', 'received', 'aftersale', 'cancelled'])

const SALES_ORDER_INCLUDE = {
  items: {
    orderBy: { createdAt: 'asc' },
    include: { productionTasks: { orderBy: { unitIndex: 'asc' } } }
  }
}

function parseConfig(value) {
  try { return JSON.parse(value || '{}') } catch { return {} }
}

function orderActions(tasks) {
  const statuses = tasks.map(task => task.status)
  const allIn = allowed => statuses.length > 0 && statuses.every(status => allowed.includes(status))
  return {
    canCancel: allIn(['pending', 'paid']) && tasks.every(task => !task.batchId),
    canConfirmReceipt: statuses.some(status => status === 'shipped') && allIn(['shipped', 'received']),
    canRequestRefund: allIn(['paid', 'locked', 'processing', 'producing', 'shipped', 'received']),
    canRequestQuality: allIn(['received']),
  }
}

function salesOrderStatus(order) {
  const tasks = order.items.flatMap((item) => item.productionTasks);
  const status = summarizeProductionStatus(tasks);
  return status === "paid" && tasks.some((task) => task.batchId)
    ? "producing"
    : status;
}

function preOrderStatus(order, now = new Date()) {
  return order.status === "pending_payment" && order.expiresAt <= now
    ? "expired"
    : order.status;
}

function preOrderSnapshot(order) {
  try {
    return readCheckoutSnapshot(order.checkoutSnapshot);
  } catch {
    return null;
  }
}

function serializePreOrder(fastify, order, includeAddress = false) {
  const snapshot = preOrderSnapshot(order);
  const state = preOrderStatus(order);
  const pending = state === "pending_payment";
  const snapshotItems = snapshot?.items || [
    {
      itemType: "CUSTOM",
      title: "历史订单商品明细缺失",
      sku: { id: "unknown" },
      quantity: 1,
      unitPrice: Number(order.totalAmount),
      lineTotal: Number(order.totalAmount),
    },
  ];
  const items = snapshotItems.map((item, index) => ({
    id: `${order.id}-${index}`,
    itemNo: `PO-${index + 1}`,
    itemType: item.itemType,
    productTitle: item.title || "商品",
    coverUrl: ossSign(fastify, item.previewUrl),
    modelName: item.sku?.modelName || null,
    size: item.sku?.size || null,
    material: item.sku?.material || null,
    frameCount: item.sku?.frameCount || null,
    colorName: item.sku?.colorName || null,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    lineTotal: Number(item.lineTotal),
    animationAssetId: item.animationAssetId || null,
    animationVersionId: item.animationVersionId || null,
    skuId: item.sku.id,
  }));
  const first = items[0];
  return {
    id: `pre-${order.id}`,
    kind: "pre_order",
    orderNo: `PO-${order.id.slice(0, 8).toUpperCase()}`,
    status: pending ? "pending" : "cancelled",
    displayStatus: pending
      ? snapshot
        ? "待付款"
        : "待付款（资料异常）"
      : state === "expired"
        ? "已超时"
        : "已取消",
    statusGroup: pending ? "pending" : "cancelled",
    statusStep: pending ? 0 : -1,
    sourceType: items.every((item) => item.itemType === "MARKET")
      ? "collab"
      : "custom",
    platform: "SELF",
    productTitle:
      items.length > 1
        ? `${items.length} 种商品 · 共 ${items.reduce((sum, item) => sum + item.quantity, 0)} 件`
        : first.productTitle,
    coverUrl: first.coverUrl,
    modelName: first.modelName,
    size: first.size,
    material: first.material,
    frameCount: first.frameCount,
    colorName: first.colorName,
    totalAmount: Number(order.totalAmount),
    itemCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    items,
    actions: {
      canCancel: pending && !!snapshot,
      canConfirmReceipt: false,
      canRequestRefund: false,
      canRequestQuality: false,
    },
    trackingNo: null,
    trackingCompany: null,
    shippedAt: null,
    receivedAt: null,
    paidAt: null,
    earliestProductionAt: null,
    expiresAt: order.expiresAt,
    receiverName: order.receiverName || null,
    receiverCity: order.receiverCity || null,
    receiverPhone: includeAddress ? order.receiverPhone || null : null,
    receiverAddress: includeAddress ? order.receiverAddress || null : null,
    createdAt: order.createdAt,
    updatedAt: order.createdAt,
  };
}

function serializeSalesOrder(fastify, order, includeAddress = false) {
  const tasks = order.items.flatMap(item => item.productionTasks)
  const status = salesOrderStatus(order)
  const display = STATUS_MAP[status] || { label: status, group: 'unknown', step: -1 }
  const actions = orderActions(tasks)
  const items = order.items.map(item => {
    const config = parseConfig(item.configSnapshotJson)
    const firstTask = item.productionTasks[0]
    let previewUrl = ossSign(fastify, item.snapshotPreviewUrl)
    if (!previewUrl && firstTask?.frameUrls) {
      try { previewUrl = ossSign(fastify, JSON.parse(firstTask.frameUrls)[0]) } catch {}
    }
    return {
      id: item.id,
      itemNo: item.itemNo,
      itemType: item.itemType,
      productTitle: item.snapshotTitle,
      coverUrl: previewUrl,
      modelName: config.modelName || firstTask?.modelName || null,
      size: config.size || firstTask?.size || null,
      material: config.material || firstTask?.material || null,
      frameCount: config.skuFrameCount || firstTask?.frameCount || null,
      colorName: config.colorName || firstTask?.colorName || null,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
      animationAssetId: item.animationAssetId,
      animationVersionId: item.animationVersionId,
      skuId: item.skuId
    }
  })
  const firstItem = items[0] || {}
  const trackingTasks = tasks.filter(task => task.trackingNo)
  return {
    id: order.id,
    kind: 'sales_order',
    orderNo: order.orderNo,
    status,
    displayStatus: display.label,
    statusGroup: display.group,
    statusStep: display.step,
    sourceType: order.items.every(item => item.itemType === 'MARKET') ? 'collab' : 'custom',
    platform: order.platform,
    productTitle: items.length > 1 ? `${items.length} 种商品 · 共 ${items.reduce((sum, item) => sum + item.quantity, 0)} 件` : firstItem.productTitle,
    coverUrl: firstItem.coverUrl || null,
    modelName: firstItem.modelName || null,
    size: firstItem.size || null,
    material: firstItem.material || null,
    frameCount: firstItem.frameCount || null,
    colorName: firstItem.colorName || null,
    totalAmount: Number(order.totalAmount),
    itemCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    items,
    actions,
    trackingNo: trackingTasks.length === tasks.length && new Set(trackingTasks.map(task => task.trackingNo)).size === 1 ? trackingTasks[0]?.trackingNo : null,
    trackingCompany: trackingTasks.length === tasks.length && new Set(trackingTasks.map(task => task.trackingCompany)).size === 1 ? trackingTasks[0]?.trackingCompany : null,
    shippedAt: tasks.length && tasks.every(task => ['shipped', 'received'].includes(task.status))
      ? tasks.reduce((latest, task) => !latest || task.shippedAt > latest ? task.shippedAt : latest, null)
      : null,
    receivedAt: order.receivedAt || null,
    paidAt: order.paidAt || null,
    earliestProductionAt: order.earliestProductionAt || null,
    expiresAt: null,
    receiverName: order.receiverName || null,
    receiverCity: order.receiverCity || null,
    ...(includeAddress ? {
      receiverPhone: order.receiverPhone || null,
      receiverAddress: order.receiverAddress || null
    } : {}),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  }
}

async function orderRoutes(fastify, opts) {
  const { prisma } = fastify

  // 所有接口统一检查设备会话和账号状态。
  fastify.addHook('preHandler', async (req, reply) => {
    return fastify.authenticate(req, reply)
  })

  // ──────────────────────────────────────────────
  // GET /api/orders/mine?tab=active&page=1&limit=30
  // 获取当前用户订单列表
  // ──────────────────────────────────────────────
  fastify.get("/mine", async (req, reply) => {
    const userId = req.user.userId;
    const tab = req.query.tab === "all" ? "all" : "active";
    const page = Math.max(
      1,
      Math.min(100000, Number.parseInt(req.query.page, 10) || 1),
    );
    const limit = Math.max(
      1,
      Math.min(50, Number.parseInt(req.query.limit, 10) || 30),
    );
    const filter = ORDER_FILTERS.has(req.query.status)
      ? req.query.status
      : "all";
    const search =
      typeof req.query.q === "string"
        ? req.query.q.trim().slice(0, 80).toLocaleLowerCase()
        : "";
    const now = new Date();

    // 展示前处理本用户到期的预订单，确保待付款按钮和库存状态一致。
    const overdue = await prisma.preOrder.findMany({
      where: { userId, status: "pending_payment", expiresAt: { lte: now } },
    });
    for (const order of overdue) {
      try {
        await closePreOrderAndRelease(prisma, order, 'expired')
      } catch (error) {
        fastify.log.error({ err: error, preOrderId: order.id }, '预订单到期处理失败')
      }
    }

    // 先取轻量索引来跨两张表排序，只读取当前页的完整订单和商品快照。
    const [salesIndex, preIndex] = await Promise.all([
      prisma.salesOrder.findMany({
        where: { userId },
        select: {
          id: true,
          orderNo: true,
          createdAt: true,
          items: {
            select: {
              snapshotTitle: true,
              productionTasks: { select: { status: true, batchId: true } },
            },
          },
        },
      }),
      prisma.preOrder.findMany({
        where: {
          userId,
          status: { in: ["pending_payment", "expired", "cancelled"] },
        },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          checkoutSnapshot: true,
        },
      }),
    ]);
    const indexed = [
      ...salesIndex.map((order) => ({
        id: order.id,
        kind: "sales_order",
        createdAt: order.createdAt,
        status: salesOrderStatus(order),
        searchText:
          `${order.orderNo} ${order.items.map((item) => item.snapshotTitle).join(" ")}`.toLocaleLowerCase(),
      })),
      ...preIndex.map((order) => ({
        id: order.id,
        kind: "pre_order",
        createdAt: order.createdAt,
        status:
          preOrderStatus(order, now) === "pending_payment"
            ? "pending"
            : "cancelled",
        searchText:
          `PO-${order.id.slice(0, 8)} ${order.id} ${(preOrderSnapshot(order)?.items || []).map((item) => item.title || "").join(" ")}`.toLocaleLowerCase(),
      })),
    ];
    const activeCount = indexed.filter((order) =>
      ACTIVE_STATUSES.includes(order.status),
    ).length;
    const totalCount = indexed.length;
    const filtered = indexed
      .filter(
        (order) =>
          (tab === "all" || ACTIVE_STATUSES.includes(order.status)) &&
          (filter === "all" ||
            (filter === "producing"
              ? ["locked", "processing", "producing"].includes(order.status)
              : order.status === filter)) &&
          (!search || order.searchText.includes(search)),
      )
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    const skip = (page - 1) * limit;
    const selected = filtered.slice(skip, skip + limit);
    const salesIds = selected
      .filter((row) => row.kind === "sales_order")
      .map((row) => row.id);
    const preIds = selected
      .filter((row) => row.kind === "pre_order")
      .map((row) => row.id);
    const [salesOrders, preOrders] = await Promise.all([
      salesIds.length
        ? prisma.salesOrder.findMany({
            where: { id: { in: salesIds }, userId },
            include: SALES_ORDER_INCLUDE,
          })
        : [],
      preIds.length
        ? prisma.preOrder.findMany({ where: { id: { in: preIds }, userId } })
        : [],
    ]);
    const salesById = new Map(salesOrders.map((order) => [order.id, order]));
    const preById = new Map(preOrders.map((order) => [order.id, order]));
    const result = selected.map((row) =>
      row.kind === "sales_order"
        ? serializeSalesOrder(fastify, salesById.get(row.id))
        : serializePreOrder(fastify, preById.get(row.id)),
    );

    return reply.send({
      success: true,
      data: {
        orders: result,
        activeCount,
        totalCount,
        page,
        limit,
        hasMore: skip + result.length < filtered.length,
      },
    });
  });

  // ──────────────────────────────────────────────
  // POST /api/orders/:id/confirm-receipt
  // 确认收货：status shipped → received
  // ──────────────────────────────────────────────
  fastify.post('/:id/confirm-receipt', async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

    const salesOrder = await prisma.salesOrder.findFirst({
      where: { id, userId }, include: SALES_ORDER_INCLUDE
    })
    if (salesOrder) {
      const tasks = salesOrder.items.flatMap(item => item.productionTasks)
      if (!tasks.length || tasks.some(task => !['shipped', 'received'].includes(task.status))) {
        return reply.code(400).send({ success: false, message: '订单中仍有商品尚未发货，暂时不能确认收货' })
      }
      const now = new Date()
      await prisma.$transaction(async tx => {
        await tx.customizeOrder.updateMany({
          where: { id: { in: tasks.map(task => task.id) }, status: 'shipped' },
          data: { status: 'received', receivedAt: now }
        })
        await tx.salesOrderItem.updateMany({ where: { salesOrderId: id }, data: { status: 'received' } })
        await tx.salesOrder.update({ where: { id }, data: { status: 'received', receivedAt: now } })
      })
      return reply.send({ success: true, data: { status: 'received' } })
    }

    return reply.code(404).send({ success: false, message: '订单不存在' })
  })

  // ──────────────────────────────────────────────
  // POST /api/orders/:id/cancel
  // 取消订单：仅限 pending / paid 状态
  // paid 状态需释放已锁库存
  // ──────────────────────────────────────────────
  fastify.post('/:id/cancel', async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

    if (id.startsWith("pre-")) {
      const preOrder = await prisma.preOrder.findFirst({
        where: { id: id.slice(4), userId },
      });
      if (!preOrder)
        return reply.code(404).send({ success: false, message: "订单不存在" });
      if (preOrder.status !== "pending_payment")
        return reply
          .code(409)
          .send({ success: false, message: "订单状态已改变，请刷新后重试" });
      if (preOrder.expiresAt <= new Date()) {
        await closePreOrderAndRelease(prisma, preOrder, "expired");
        return reply
          .code(409)
          .send({
            success: false,
            message: "付款时间已结束，请返回购物车重新结算",
          });
      }
      const cancelled = await closePreOrderAndRelease(
        prisma,
        preOrder,
        "cancelled",
      );
      if (!cancelled)
        return reply
          .code(409)
          .send({ success: false, message: "订单状态已改变，请刷新后重试" });
      return reply.send({ success: true, data: { status: "cancelled" } });
    }

    const salesOrder = await prisma.salesOrder.findFirst({
      where: { id, userId }, include: SALES_ORDER_INCLUDE
    })
    if (salesOrder) {
      const tasks = salesOrder.items.flatMap(item => item.productionTasks)
      if (!tasks.length || tasks.some(task => !['pending', 'paid'].includes(task.status) || task.batchId)) {
        return reply.code(400).send({ success: false, message: '订单中已有商品进入生产，如需取消请联系客服' })
      }
      try {
        await prisma.$transaction(async tx => {
          const cancelled = await tx.customizeOrder.updateMany({
            where: { id: { in: tasks.map(task => task.id) }, status: { in: ['pending', 'paid'] }, batchId: null },
            data: { status: 'cancelled' }
          })
          if (cancelled.count !== tasks.length) throw Object.assign(new Error('订单状态已改变'), { code: 'ORDER_STATE_CHANGED' })
          await tx.salesOrderItem.updateMany({ where: { salesOrderId: id }, data: { status: 'cancelled' } })
          await tx.salesOrder.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date() } })
          for (const item of salesOrder.items) {
            await unlockInventoryInTransaction(tx, item.skuId, item.quantity, id, `sales_order_cancel_${id}_${item.id}`)
          }
        })
      } catch (error) {
        if (error.code === 'ORDER_STATE_CHANGED') return reply.code(409).send({ success: false, message: '订单状态已改变，请刷新后重试' })
        throw error
      }
      return reply.send({ success: true, data: { status: 'cancelled' } })
    }

    return reply.code(404).send({ success: false, message: '订单不存在' })
  })

  // ──────────────────────────────────────────────
  // GET /api/orders/:id
  // 单个订单详情（含物流信息）
  // ──────────────────────────────────────────────
  fastify.get('/:id', async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

    if (id.startsWith("pre-")) {
      let preOrder = await prisma.preOrder.findFirst({
        where: { id: id.slice(4), userId },
      });
      if (!preOrder)
        return reply.code(404).send({ success: false, message: "订单不存在" });
      if (preOrder.status === "paid") {
        const paidOrder = await prisma.salesOrder.findFirst({
          where: { preOrderId: preOrder.id, userId },
          include: SALES_ORDER_INCLUDE,
        });
        return paidOrder
          ? reply.send({
              success: true,
              data: serializeSalesOrder(fastify, paidOrder, true),
            })
          : reply
              .code(409)
              .send({ success: false, message: "支付结果处理中，请稍后刷新" });
      }
      if (
        preOrderStatus(preOrder) === "expired" &&
        preOrder.status === "pending_payment"
      ) {
        try {
          await closePreOrderAndRelease(prisma, preOrder, 'expired')
          preOrder = await prisma.preOrder.findUnique({ where: { id: preOrder.id } })
        } catch (error) {
          fastify.log.error({ err: error, preOrderId: preOrder.id }, '预订单到期处理失败')
        }
      }
      return reply.send({
        success: true,
        data: serializePreOrder(fastify, preOrder, true),
      });
    }

    const salesOrder = await prisma.salesOrder.findFirst({
      where: { id, userId }, include: SALES_ORDER_INCLUDE
    })
    if (salesOrder) {
      return reply.send({ success: true, data: serializeSalesOrder(fastify, salesOrder, true) })
    }

    return reply.code(404).send({ success: false, message: '订单不存在' })
  })
  // ──────────────────────────────────────────────
  // POST /api/orders/:id/aftersale
  // 提交售后申请（退款 or 质量问题）
  // 允许状态：paid / locked / processing / producing / shipped / received
  // ──────────────────────────────────────────────
  fastify.post('/:id/aftersale', async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
    const { type, reason, description, imageUrls = [] } = payload

    // 参数校验
    const VALID_TYPES = ['refund', 'quality']
    if (!VALID_TYPES.includes(type)) {
      return reply.code(400).send({ success: false, message: '申请类型无效' })
    }
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 100) {
      return reply.code(400).send({ success: false, message: '申请原因无效' })
    }
    if (description != null && (typeof description !== 'string' || description.length > 300)) {
      return reply.code(400).send({ success: false, message: '补充说明无效' })
    }
    if (!Array.isArray(imageUrls) || imageUrls.length > 3 || imageUrls.some(key => typeof key !== 'string' || !key.trim())) {
      return reply.code(400).send({ success: false, message: '售后图片无效' })
    }

    const salesOrder = await prisma.salesOrder.findFirst({
      where: { id, userId }, include: SALES_ORDER_INCLUDE
    })
    if (!salesOrder) return reply.code(404).send({ success: false, message: '订单不存在' })
    const salesTasks = salesOrder.items.flatMap(item => item.productionTasks)
    const order = salesTasks[0]
    if (!order) return reply.code(400).send({ success: false, message: '订单生产任务不存在' })

    const AFTERSALE_ALLOW = ['paid', 'locked', 'processing', 'producing', 'shipped', 'received']
    const relevantTasks = salesTasks
    if (!relevantTasks.length || relevantTasks.some(task => !AFTERSALE_ALLOW.includes(task.status))) {
      return reply.code(400).send({
        success: false,
        message: '订单中有商品处于不可申请售后的状态',
      })
    }
    if (type === 'quality' && relevantTasks.some(task => task.status !== 'received')) {
      return reply.code(400).send({ success: false, message: '质量问题售后需在确认收货后申请' })
    }
    if (relevantTasks.some(task => task.aftersaleCount >= 3)) {
      return reply.code(400).send({ success: false, message: '申请次数已达上限（3次），请联系客服处理' })
    }

    // 检查是否已有 pending 申请
    const existing = await prisma.aftersaleRequest.findFirst({
      where: { orderId: { in: relevantTasks.map(task => task.id) }, status: 'pending' },
    })
    if (existing) {
      return reply.code(400).send({ success: false, message: '已有处理中的申请，请等待客服回复' })
    }

    let evidenceFiles = []
    try {
      evidenceFiles = await findOwnedReadyFiles(prisma, imageUrls, userId, [FILE_PURPOSE.AFTERSALE_EVIDENCE])
    } catch (error) {
      return reply.code(400).send({ success: false, message: error.message })
    }

    // 事务：创建申请 + 订单变为 aftersale + 次数+1
    await prisma.$transaction(async tx => {
      const aftersale = await tx.aftersaleRequest.create({
        data: {
          orderId: order.id,
          userId,
          type,
          reason: reason.trim(),
          description: [`用户订单：${salesOrder.orderNo}`, description?.trim() || null].filter(Boolean).join('\n'),
          imageUrls: JSON.stringify(Array.isArray(imageUrls) ? imageUrls : []),
        },
      })
      await linkFiles(tx, evidenceFiles, 'AFTERSALE_REQUEST', aftersale.id)
      await tx.customizeOrder.updateMany({
        where: { id: { in: relevantTasks.map(task => task.id) } },
        data: { status: 'aftersale' },
      })
      await tx.customizeOrder.update({ where: { id: order.id }, data: { aftersaleCount: { increment: 1 } } })
      await tx.salesOrderItem.updateMany({ where: { salesOrderId: salesOrder.id }, data: { status: 'aftersale' } })
      await tx.salesOrder.update({ where: { id: salesOrder.id }, data: { status: 'aftersale' } })
    })

    return reply.send({ success: true, data: { status: 'aftersale' } })
  })

  // ──────────────────────────────────────────────
  // GET /api/orders/:id/aftersale
  // 查看订单最新一条售后申请详情
  // ──────────────────────────────────────────────
  fastify.get('/:id/aftersale', async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

    const salesOrder = await prisma.salesOrder.findFirst({
      where: { id, userId }, include: SALES_ORDER_INCLUDE
    })
    if (!salesOrder) return reply.code(404).send({ success: false, message: '订单不存在' })
    const taskIds = salesOrder.items.flatMap(item => item.productionTasks.map(task => task.id))

    const request = await prisma.aftersaleRequest.findFirst({
      where: { orderId: { in: taskIds } },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ success: true, data: request || null })
  })
}

export default orderRoutes
