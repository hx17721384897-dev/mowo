# API.md — 哞屋 MOWO 接口文档

> 最后更新：2026-04-16（新增用户订单接口）
> 后端服务：Node.js + Fastify，端口 **3001**
> 本地地址：`http://localhost:3001`
> 生产地址：`https://api.mowo.com`（待部署）

---

## 通用约定

### 请求头

```
Content-Type: application/json
Authorization: Bearer <accessToken>   // 需要登录的接口必须携带
```

### 统一响应格式

```json
// 成功
{ "success": true, "data": { ... } }

// 失败
{ "success": false, "message": "错误描述" }
```

### 角色权限

| role 值 | 角色 | 说明 |
|---------|------|------|
| 0 | User | 普通用户 |
| 1 | Production | 生产端（查看订单/下载图纸/库存入库） |
| 2 | Admin | 管理员（全部后台） |
| 3 | SuperAdmin | 超级管理员（含审计日志/角色管理） |

### JWT Payload

```json
{ "userId": "uuid", "phone": "138****", "certifyStatus": 2, "role": 0 }
```

---

## 接口目录

| 前缀 | 模块 | 文件 |
|------|------|------|
| `/api/v1/auth` | 账户安全v1（推荐） | `routes/auth-v1.js` |
| `/api/auth` | 旧版认证（兼容） | `routes/auth.js` |
| `/api/users` | 用户信息/关注 | `routes/users.js` |
| `/api/certify` | 创作者认证 | `routes/certify.js` |
| `/api/animations` | 动画上传管理 | `routes/animations.js` |
| `/api/products` | 商品 | `routes/products.js` |
| `/api/machine-models` | 机型款式与SKU | `routes/machine-models.js` |
| `/api/customize-orders` | 定制订单 | `routes/customize-orders.js` |
| `/api/upload` | OSS预签名上传 | `routes/upload.js` |
| `/api/cart` | 购物车 | `routes/cart.js` |
| `/api/addresses` | 收货地址簿 | `routes/addresses.js` |
| `/api/custom-products` | DIY定制草稿 | `routes/custom-products.js` |
| `/api/orders` | 用户订单查询与确认收货 | `routes/orders.js` |
| `/api/payment` | 支付回调与状态 | `routes/payment.js` |
| `/api/inventory` | 库存管理 | `routes/inventory.js` |
| `/api/collab` | 联名系统（公开+创作者） | `routes/collab.js` |
| `/api/admin` | 管理员后台 | `routes/admin.js` |
| `/api/admin/import` | 多平台订单导入 | `routes/import.js` |
| `/api/admin/sku-mapping` | 平台SKU映射管理 | `routes/platform-sku.js` |
| `/api/creator` | 创作者端 | `routes/creator.js` |

---

## 账户安全 v1（推荐路径）

### POST `/api/v1/auth/send-code`
发送短信验证码。

**Body：**
```json
{ "phone": "13800138000", "purpose": "LOGIN" }
```
purpose 枚举：`LOGIN / REGISTER / RESET_PASSWORD / BIND_PHONE / DEACTIVATE / STEP_UP_WITHDRAW / STEP_UP_CHANGE_PAYOUT / STEP_UP_CHANGE_PASSWORD`

**限速**：单号每分钟1条，每天10条；全局每小时500条。

---

### POST `/api/v1/auth/login`
短信验证码登录，返回 accessToken + 设置 refreshToken HttpOnly Cookie。

**Body：**
```json
{ "phone": "13800138000", "code": "123456" }
```

**Response：**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "user": { "id": "...", "phone": "...", "role": 0, "certifyStatus": 0 }
  }
}
```

---

### POST `/api/v1/auth/refresh`
刷新 accessToken（需携带 refreshToken Cookie）。

---

### POST `/api/v1/auth/logout`
注销当前会话，撤销 refreshToken，记录审计日志。需携带 Authorization。

---

### POST `/api/v1/user/deactivate`
申请注销账号（PIPL软删除）。需登录 + 短信验证。

**Body：**
```json
{ "code": "123456", "reason": "不想用了" }
```

---

## 购物车系统

### GET `/api/cart`
获取当前用户购物车（含实时价格/库存校验，按创作者分组）。需登录。

**Response data：**
```json
{
  "items": [
    {
      "id": "cart_item_id",
      "itemType": "CUSTOM",
      "snapshotTitle": "哞屋 55mm 12帧 木质款",
      "quantity": 1,
      "currentPrice": 199.00,
      "snapshotPrice": 199.00,
      "status": "normal",
      "coverUrl": "https://...",
      "hardwareSkuId": "sku_id"
    }
  ],
  "totalAmount": 199.00
}
```

---

### POST `/api/cart/add`
加入购物车。相同 `contentId + hardwareSkuId` 幂等叠加数量。需登录。

**Body：**
```json
{
  "itemType": "CUSTOM",
  "contentId": "custom_product_id",
  "hardwareSkuId": "sku_id",
  "quantity": 1
}
```
itemType 为 `MARKET` 时 contentId 填 collab_work.id。

---

### POST `/api/cart/item/:id/update`
修改购物车条目数量或选中状态。需登录。

**Body：**
```json
{ "quantity": 2, "selected": true }
```
quantity 范围：1-100。

---

### DELETE `/api/cart/item/:id`
删除购物车条目（联动取消预订单 + 释放库存）。需登录。

---

### POST `/api/cart/clear`
清空购物车。需登录。

---

### POST `/api/cart/merge`
游客购物车合并（登录后将本地缓存同步到服务端）。需登录。

**Body：**
```json
{
  "items": [
    { "itemType": "CUSTOM", "contentId": "...", "hardwareSkuId": "...", "quantity": 1 }
  ]
}
```

---

### POST `/api/cart/checkout`
结算：创建 PreOrder，10分钟库存预锁。需登录。

**Body：**
```json
{
  "cartItemIds": ["item_id_1", "item_id_2"],
  "receiverName": "张三",
  "receiverPhone": "13800138000",
  "receiverAddress": "北京市朝阳区某街道某楼",
  "receiverCity": "北京市"
}
```

**Response data：**
```json
{
  "id": "pre_order_id",
  "totalAmount": 398.00,
  "expiresAt": "2026-04-16T10:10:00Z",
  "status": "pending_payment"
}
```

---

### POST `/api/cart/price-changes/confirm-all`
一键接受所有价格变动（将 `price_changed` 条目快照更新为当前价）。需登录。

---

## 收货地址簿

所有接口均需登录（JWT preHandler）。

### GET `/api/addresses`
获取当前用户全部地址，按 `isDefault DESC, createdAt ASC` 排序。

**Response data：** `[ { id, label, name, phone, province, city, district, detail, isDefault } ]`

---

### POST `/api/addresses`
新建地址。第一条自动设为默认。每用户最多20条。

**Body：**
```json
{
  "label": "家",
  "name": "张三",
  "phone": "13800138000",
  "province": "北京市",
  "city": "北京市",
  "district": "朝阳区",
  "detail": "某街道某楼101室"
}
```

---

### PUT `/api/addresses/:id`
更新地址（只校验传入的字段，支持部分更新）。仅本人可操作。

---

### DELETE `/api/addresses/:id`
删除地址。删除默认地址时自动将最新的其他地址升为默认。

---

### PUT `/api/addresses/:id/default`
设为默认地址（事务：先清除所有默认，再设目标）。

---

## DIY定制草稿

### POST `/api/custom-products`
创建草稿。需登录。

**Body：**
```json
{
  "animationFrames": "[\"frame1.jpg\", \"frame2.jpg\"]",
  "configJson": "{\"frameCount\": 12, \"size\": \"55mm\", \"material\": \"木质\", \"colorName\": \"原色\", \"skuId\": \"...\", \"modelId\": \"...\"}",
  "hardwareSkuId": "sku_id",
  "frameCount": 12
}
```

**Response data：** `{ id, status: "draft", draftExpiresAt: "..." }`

---

### GET `/api/custom-products/:id`
获取草稿详情。需登录（仅本人可查）。

---

### PUT `/api/custom-products/:id`
更新草稿（自动延长7天有效期）。`ordered` 和 `removed` 状态不可编辑。

---

### POST `/api/custom-products/:id/regenerate-preview`
重新生成预览图（当前为Mock，TODO接生产队列）。

---

## 用户订单

### GET `/api/orders/mine`
获取当前用户的订单列表。需登录。

**Query 参数：**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `tab` | `active` | `active`=进行中（非已完成/已取消）/ `all`=全部 |
| `page` | `1` | 页码 |
| `limit` | `30` | 每页数量（最大50） |

**Response data：**
```json
{
  "orders": [
    {
      "id": "order_id",
      "orderNo": "ORD-xxx",
      "status": "shipped",
      "displayStatus": "运输中",
      "statusGroup": "shipped",
      "statusStep": 2,
      "sourceType": "custom",
      "modelName": "经典圆筒款",
      "size": "55mm",
      "material": "木质",
      "frameCount": 12,
      "colorName": "原色",
      "productTitle": "DIY 定制款 · 55mm 12帧 原色",
      "totalAmount": 199.00,
      "trackingNo": "SF1234567890",
      "trackingCompany": "顺丰",
      "receiverName": "张三",
      "receiverCity": "北京市",
      "coverUrl": null,
      "createdAt": "2026-04-16T10:00:00Z"
    }
  ],
  "activeCount": 2,
  "totalCount": 5,
  "page": 1,
  "limit": 30,
  "hasMore": false
}
```

**statusGroup 枚举与含义：**

| statusGroup | displayStatus | 对应后端 status | 说明 |
|-------------|--------------|----------------|------|
| `pending` | 待付款 | pending | 待支付（SELF平台基本不出现） |
| `making` | 制作中 | paid/locked/processing/producing | 订单确认至生产阶段 |
| `shipped` | 运输中 | shipped | 已发货，可确认收货 |
| `done` | 已完成 | received | 已确认收货 |
| `aftersale` | 售后中 | aftersale | 售后处理中 |
| `cancelled` | 已取消 | cancelled | 已取消 |

---

### GET `/api/orders/:id`
获取单个订单详情（含完整收件信息）。需登录。

---

### POST `/api/orders/:id/confirm-receipt`
确认收货。需登录。

- 仅 `status=shipped` 的订单可调用
- 更新 `customize_orders.status → received`
- 若 `sourceType=collab`：同步将 `collab_orders.revenueStatus → cooling`，写入 `coolingEndAt = now + 15天`

**Response data：** `{ "status": "received" }`

---

### POST `/api/orders/:id/cancel`
取消订单。需登录。

- 仅 `status=pending` 或 `status=paid` 的订单可取消
- 其他状态返回 400，提示「如需取消请联系客服」
- `status=paid` 且有关联 `skuId`：自动调用 `unlockInventory()` 释放已锁库存（幂等key: `cancel_order:{orderId}`）
- 更新 `customize_orders.status → cancelled`

**Response data：** `{ "status": "cancelled" }`

---

## 支付

### POST `/api/payment/callback`
微信支付结果回调（生产环境需验签，当前Mock）。

支付成功时事务内执行：
1. PreOrder → `paid`
2. 按 CartItem.itemType 创建对应订单（CustomizeOrder 或 CollabOrder）
3. CustomProduct 状态 → `ordered`
4. CartItem 标记 `invalid`

---

### GET `/api/payment/status/:preOrderId`
前端轮询支付状态（含超时自动 expired 逻辑）。需登录。

**Response data：**
```json
{ "status": "pending_payment", "expired": false, "totalAmount": 199.00 }
```

---

### POST `/api/payment/mock-pay/:preOrderId`
开发模式模拟支付成功（生产环境返回403）。需登录。

---

## 库存管理

### GET `/api/inventory`
所有SKU库存列表（含4态库存 + 三级预警）。需 role≥2。

**Response data：**
```json
[
  {
    "skuId": "...",
    "skuCode": "STD-55-12F-WD-NA",
    "currentStock": 100,
    "reservedStock": 10,
    "wipFrameQty": 5,
    "wipKitQty": 5,
    "available": 80,
    "alertLevel": "OK",
    "safetyStock": 20
  }
]
```

---

### GET `/api/inventory/:skuId`
单SKU库存详情 + 最近100条变动记录。需 role≥2。

---

### POST `/api/inventory/:skuId/restock`
手动盘点入库。需 role≥1（负数需 role≥2）。

**Body：**
```json
{ "quantity": 50, "reason": "补货入库" }
```

---

### PUT `/api/inventory/:skuId/settings`
修改预警设置。需 role≥2。

**Body：**
```json
{ "safetyStock": 20, "maxOrderLimit": 50, "safetyFactor": 1.5 }
```

---

### GET `/api/inventory/logs`
全局库存变动记录（分页，支持按 skuId/type 过滤）。需 role≥2。

**Query：** `?skuId=...&type=manual_adjustment&page=1&limit=20`

---

### GET `/api/inventory/snapshots`
历史库存快照查询。需 role≥2。

**Query：** `?date=2026-04-01&skuId=...`

---

### GET `/api/inventory/channel-quotas`
查看渠道配额建议（按可用库存×35%/35%/30%计算）。需 role≥2。

---

### PUT `/api/inventory/channel-quotas/:skuId`
更新渠道配额（upsert）。需 role≥2。

**Body：**
```json
{ "bufferPool": 10, "taobaoQty": 30, "douyinQty": 30, "xhsQty": 20, "livestreamMode": false }
```

---

### POST `/api/inventory/ship`
扫码发货（生产端）。需 role≥1。

**Body：**
```json
{ "skuBarcode": "MOWO-SKU-0001-0001", "orderId": "order_id" }
```

验证 skuBarcode 与订单SKU匹配后：
- 生成 auth_code（正版验证码）
- 写 inventory_log（wip_deduct）
- 记录 order_item_binding

---

### GET `/api/inventory/verify/:code`
正版验证（无需登录）。返回机型/尺寸/材质/发货时间。

---

## 多平台订单导入

所有接口需 role≥2（requireAdmin）。

### POST `/api/admin/import/taobao`
上传淘宝 CSV 批量导入。Content-Type: multipart/form-data。

处理流程：
1. 解析CSV（中文表头自动映射）
2. 幂等去重（platform+externalOrderId 联合唯一）
3. 匹配 platform_sku_mappings
4. 收件信息不完整 → `importStatus=pending_info`
5. SKU未知 → `importStatus=pending_sku`
6. 正常订单 → 调 lockInventory 预锁库存

**Response data：**
```json
{ "created": 45, "skipped": 3, "pendingInfo": 2, "pendingSku": 1 }
```

---

### POST `/api/admin/import/manual`
手动录入单条订单（抖音/小红书/淘宝人工补录）。

**Body：**
```json
{
  "platform": "DOUYIN",
  "externalOrderId": "DY20260416001",
  "skuCode": "STD-55-12F-WD-NA",
  "receiverName": "李四",
  "receiverPhone": "13900139000",
  "receiverAddress": "上海市浦东新区某路某号",
  "receiverCity": "上海市",
  "frameUrls": [],
  "ossPath": ""
}
```

---

### GET `/api/admin/import/pending`
查看异常订单列表（分页）。

**Query：** `?type=pending_sku&page=1&limit=20`
type 可选：`pending_info` / `pending_sku` / 不传=全部异常

---

### PUT `/api/admin/import/:orderId/resolve`
人工补全异常订单（补收件信息 或 指定SKU映射）。

**Body（补收件信息）：**
```json
{
  "receiverName": "王五",
  "receiverPhone": "13700137000",
  "receiverAddress": "广州市天河区某路某号",
  "receiverCity": "广州市"
}
```

**Body（指定SKU + 可选保存映射）：**
```json
{
  "skuCode": "STD-55-12F-WD-NA",
  "saveMapping": true
}
```
`saveMapping=true` 时自动将外部描述写入 `platform_sku_mappings`。

---

## 平台SKU映射管理

所有接口需 role≥2。

### GET `/api/admin/sku-mapping`
列表（支持 platform/q 过滤，补充 skuDetails + collabWork 信息）。

**Query：** `?platform=TB&q=木质`

---

### POST `/api/admin/sku-mapping`
新建映射。

**Body：**
```json
{
  "platform": "TB",
  "externalDesc": "55mm 12帧 木质 原色",
  "internalSkuCode": "STD-55-12F-WD-NA",
  "collabWorkId": null
}
```

---

### PUT `/api/admin/sku-mapping/:id`
更新映射（`collabWorkId=""` 可清除联名绑定）。

---

### DELETE `/api/admin/sku-mapping/:id`
删除映射。

---

### GET `/api/admin/sku-mapping/resolve`
根据外部描述查询内部SKU（供导入流程使用）。

**Query：** `?platform=TB&desc=55mm 12帧 木质 原色`

---

## 管理员后台（部分）

所有接口需 role≥2。

### GET `/api/admin/stats`
平台统计数据（订单数/用户数/创作者数/本月收入）。

### GET `/api/admin/orders`
定制订单列表（分页，支持按 status/platform/batchId 过滤）。

### POST `/api/admin/orders/:id/lock`
将订单加入生产批次（批次ID = YYYYMMDD_HHMMSS，lockStatus → LOCKED）。

### POST `/api/admin/orders/export-addresses`
导出待处理订单地址（生成 Word 清单，写入 seqNo，触发 startWipFrame 锁库存）。

### POST `/api/admin/orders/export-frames/:batchId`
导出帧图压缩包（按 SKU 分文件夹，含对照清单 + 条形码清单）。

### POST `/api/admin/orders/:id/ship`
录入快递信息（company + trackingNo，status → processing）。

### GET `/api/admin/users`
用户列表（分页，支持按 role/status 过滤）。需 role≥2。

### PUT `/api/admin/users/:id/role`
修改用户角色。需 role≥3（SuperAdmin）。

### GET `/api/admin/logs`
审计日志（分页，支持按 action/userId 过滤）。需 role≥3。

---

## 联名系统

### GET `/api/collab/works`
公开联名作品列表（仅 isOnShelf=true）。无需登录。

### GET `/api/collab/works/:id`
联名作品详情（含 supportedSkus/sizes/framePackOssPath）。无需登录。

### POST `/api/collab/works`
创建联名作品申请。需登录（认证创作者）。

### GET `/api/collab/my-works`
创作者自己的联名作品列表。需登录。

### GET `/api/collab/my-earnings`
创作者联名收益（含冷却期/可提现状态）。需登录。

---

## 创作者端

### GET `/api/creator/dashboard`
创作者数据总览（牛量/收益/订单数）。需登录（认证创作者）。

### GET `/api/creator/earnings`
收益明细（分页）。需登录。

### GET `/api/creator/bull-score`
牛量积分详情（三维度分 + 等级 + 历史趋势）。需登录。

---

## 错误码参考

| HTTP状态码 | 含义 | 常见场景 |
|-----------|------|---------|
| 400 | 参数错误 | 手机号格式不对、必填字段缺失 |
| 401 | 未登录或Token过期 | Authorization头缺失/accessToken过期 |
| 403 | 权限不足 | role不够、操作他人资源 |
| 404 | 资源不存在 | 订单ID/地址ID不存在 |
| 409 | 冲突 | 重复导入同一平台订单、地址已存在 |
| 429 | 请求过频 | 短信发送超限速 |
| 500 | 服务器内部错误 | 数据库异常/OSS连接失败 |

---

## 开发工具

### Mock支付（本地开发专用）
```
POST /api/payment/mock-pay/:preOrderId
Authorization: Bearer <token>
```
仅在 `hostname === 'localhost'` 或 `127.0.0.1` 时可用，生产环境返回403。

### 库存预签名上传
```
POST /api/upload/presign-batch
Body: { folder, orderNo, files: [{ fileName, fileType }] }
Response: [{ uploadUrl, objectKey }]
```
获取批量预签名URL后，前端直接 `PUT` 上传至OSS，避免后端中转大文件。
