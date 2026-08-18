# admin-inventory.html 重设计规划（v2）

> **文档状态（2026-08-12）：库存页面规划输入，不是最终业务规则。** 已确认的高层产品边界是联名款前台不区分预制/现做，后台有成品优先分配、无成品进入生产；具体库存状态、扣减时点、扫码与生产批次关系将在实际改造该模块前，由项目负责人说明完整流程后确认。代码事实见 `modules/commerce-orders-inventory.md` 与 `modules/admin-production.md`。

> 目标：看清库存状态 + 管控库存规则 + 追踪库存变化。
> 约束：后端只做加法，不改现有 inventory.js / lib/inventory.js 逻辑。

---

## 一、核心决策

| 问题 | 决策 | 原因 |
|------|------|------|
| 材料包物品与 SKU 列表混排还是独立 Tab？ | **独立 Tab** | 业务属性不同：SKU 面向销售履约，材料面向生产供应 |
| 材料扣减逻辑 | **自动扣减 + 手动纠偏** | 手动太琐碎；建立 1:1 SKU-材料绑定关系，每出货自动扣 |
| 材料报损 | **独立"报损"操作** | 操作员点「报损 −N」，不走订单流，账实相符 |
| 材料策略字段 | **安全库存 + 采购周期 (Lead Time)** | safetyFactor 解决"留多少"，Lead Time 解决"何时下单" |
| 渠道配额冲突 | **强制弹窗提示** | SUM(配额) > 可用量时必须拦截，是防超卖核心逻辑 |
| 统计卡片中 WIP 展示 | **UI 区分帧图在制 / 材料包在制** | 两者生产周期不同，混合看意义有限 |

---

## 二、页面信息架构

```
admin-inventory.html
│
├── 顶部统计卡片（6张）
│   ├── SKU 总数
│   ├── 紧急不足（CRITICAL）
│   ├── 库存偏低（WARNING）
│   ├── 总可用库存
│   ├── 总锁定量（reservedStock 含"待支付锁定"+"已支付待生产锁定"）
│   └── 在制：帧图(wipFrameQty) / 材料包(wipKitQty)  ← 两行小字区分
│
├── 外部订单导入快捷横幅（导航至 admin-import.html）
│
└── 主 Tab（4个）
    ├── 📦 SKU 库存列表
    ├── 🧩 材料包物品
    ├── 📋 变动记录
    └── 📡 渠道配额
```

---

## 三、SKU 库存列表

### 列定义

| 列 | 字段 | 说明 |
|----|------|------|
| 色点 | alertLevel | 三色圆点 |
| 款式 | modelName | |
| 规格 | size·material·frameCount·colorName | |
| 现货 | currentStock | 等同总库存 |
| 锁定 | reservedStock | 含待支付+待生产 |
| 帧制 | wipFrameQty | 蓝 |
| 料制 | wipKitQty | 紫 |
| 可用 | availableQty | 高亮 |
| 安全线 | safetyStock | |
| 预警 | 徽章 | CRITICAL/WARNING/SUGGEST/OK |
| 操作 | — | ＋入库 / 详情 |

### SKU 详情抽屉（5 区块）

```
① 库存概况
   4态数字卡片（可用 / 锁定 / 帧制 / 料制）
   公式行：总库存 = 可用 + 锁定 + 帧制 + 料制

② 风险判断（前端计算，无新 API）
   🔴/🟡/🟢 预警等级（色灯+文字）
   触发原因：按日均销量估算可用天数  OR  低于安全线
   超卖风险：reservedStock+wipFrameQty+wipKitQty >= currentStock → 橙色警示
   渠道配额：当前配额总量 vs 可用量（简洁一行）

③ 入库 / 调减操作

④ 策略设置
   安全库存 + 最大下单量 + 流量因子（safetyFactor）

⑤ 变动记录（最近50条，10种类型完整映射）
```

**可选扩展（后期）：关联物料看板**
> 在 SKU 详情底部显示：生产该 SKU 需要的包装袋、感谢卡当前库存是否充足。
> 依赖材料-SKU绑定关系数据，初期可先展示绑定列表+库存状态。

---

## 四、材料包物品管理

### 4.1 物品列表（卡片式）

每张卡片：
- 物品名称 + 单位
- 当前库存（大数字）+ 安全线
- 预警状态（基于 Lead Time 算法）
- 绑定 SKU 数量（x 个 SKU）
- 按钮：入库 / 报损 / 编辑 / 详情

### 4.2 预警算法（材料用 Lead Time，与 SKU 预警不同）

```
dailyConsumption = 近30天消耗总量 / 30（从 material_logs 计算）
availableDays    = currentStock / dailyConsumption（如果 dailyConsumption > 0）

CRITICAL : availableDays < leadTime         → 现在下单已来不及
WARNING  : availableDays < leadTime × 1.5
SUGGEST  : availableDays < leadTime × 2
OK       : 充足

无消耗数据时：fallback 到 currentStock <= safetyStock → WARNING
```

### 4.3 新增/编辑物品弹窗

字段：物品名称、单位、安全库存、采购周期（天）、备注

### 4.4 物品详情抽屉

```
① 库存状态（大数字 + 预警）
② 入库操作（采购入库 / 期初录入）
③ 报损操作（记录报损数量 + 原因）
④ 绑定 SKU（显示与哪些 SKU 1:1 绑定，可在此管理绑定关系）
⑤ 变动记录
```

### 4.5 变动记录日志类型

| type | 前端显示 |
|------|---------|
| `purchase_in` | 📥 采购入库 |
| `order_consumed` | 🚚 订单消耗 |
| `production_defect` | 💥 生产报损 |
| `manual_adjustment` | 🔧 人工调减 |
| `opening_stock` | 🗂 期初录入 |

---

## 五、渠道配额管理（增强）

### 配额冲突强制弹窗

保存配额前验证：
```
SUM(taobaoQty + douyinQty + xhsQty) > available - bufferPool
```
若成立 → **强制弹窗**，用户必须确认"了解将超卖风险"才能保存。

### 渠道配额与订单来源

- 订单导入（admin-import.html）时写入 `sourceType='taobao'`
- 渠道配额面板显示：配置配额 vs 来自该渠道的活跃订单数（查 customize_orders）
- 本期：只做配额展示与编辑，不做实时同步（后期迭代）

---

## 六、变动记录类型映射（SKU 侧，完整10种）

| 后端 type | 前端显示 | 颜色语义 |
|-----------|---------|---------|
| `in` | 📥 入库 | 绿 |
| `out` | 📤 发货出库 | 橙 |
| `reserved` | 🔒 锁定（下单） | 蓝 |
| `released` | 🔓 释放（取消） | 紫 |
| `wip_frame_start` | 🎞 帧图开始在制 | 青 |
| `wip_kit_start` | 📦 材料包开始在制 | 青 |
| `wip_kit_rollback` | ↩️ 材料包回退 | 橙 |
| `wip_defect_frame` | 💥 帧图报废 | 红 |
| `wip_deduct` | ✅ 生产完成核销 | 深绿 |
| `manual_adjustment` | 🔧 手动修正 | 灰 |

---

## 七、后端改动（全部为新增）

### 7.1 新增3张表

#### `material_items`
```prisma
model MaterialItem {
  id           String   @id @default(uuid())
  name         String   @db.VarChar(100)
  unit         String   @default("个") @db.VarChar(20)
  currentStock Int      @default(0) @map("current_stock")
  safetyStock  Int      @default(10) @map("safety_stock")
  leadTime     Int      @default(7) @map("lead_time")    // 采购周期（天）
  note         String?  @db.VarChar(200)
  isActive     Boolean  @default(true) @map("is_active")
  createdBy    String   @map("created_by")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  logs         MaterialLog[]
  skuBindings  MaterialSkuBinding[]

  @@map("material_items")
}
```

#### `material_logs`
```prisma
model MaterialLog {
  id           String   @id @default(uuid())
  materialId   String   @map("material_id")
  type         String   @db.VarChar(30)
  // purchase_in / order_consumed / production_defect / manual_adjustment / opening_stock
  quantity     Int
  beforeQty    Int      @map("before_qty")
  afterQty     Int      @map("after_qty")
  operatorId   String   @map("operator_id")
  note         String?  @db.VarChar(200)
  orderId      String?  @map("order_id")
  createdAt    DateTime @default(now()) @map("created_at")

  material     MaterialItem @relation(fields: [materialId], references: [id])

  @@index([materialId])
  @@map("material_logs")
}
```

#### `material_sku_bindings`
```prisma
model MaterialSkuBinding {
  id         String   @id @default(uuid())
  materialId String   @map("material_id")
  skuId      String   @map("sku_id")          // machine_model_skus.id
  qtyPerUnit Int      @default(1) @map("qty_per_unit")  // 每出1个SKU消耗的数量
  createdAt  DateTime @default(now()) @map("created_at")

  material   MaterialItem @relation(fields: [materialId], references: [id])

  @@unique([materialId, skuId])
  @@map("material_sku_bindings")
}
```

### 7.2 新路由 `/api/materials/`

```
GET    /api/materials                      — 物品列表（含近30天消耗量）
POST   /api/materials                      — 新建物品
PUT    /api/materials/:id                  — 编辑（名称/单位/安全库存/采购周期/备注）
DELETE /api/materials/:id                  — 软删除（isActive=false）
POST   /api/materials/:id/restock          — 入库（purchase_in / opening_stock）
POST   /api/materials/:id/defect           — 报损（production_defect）
POST   /api/materials/:id/adjust           — 手动调减（manual_adjustment）
GET    /api/materials/:id/logs             — 变动记录
GET    /api/materials/:id/bindings         — 绑定SKU列表
POST   /api/materials/:id/bindings         — 添加绑定
DELETE /api/materials/:id/bindings/:skuId  — 删除绑定
```

### 7.3 自动扣减触发点

当 `POST /api/inventory/ship`（发货核销）成功后，后端查询该 SKU 的绑定材料，并按 `qtyPerUnit` 自动扣减材料库存，写入 `order_consumed` 类型日志。

> 此处需在 inventory.js 的 `/ship` 接口末尾追加材料扣减逻辑（约10行），其余逻辑不变。

### 7.4 注册路由（index.js）
```javascript
import materials from './routes/materials.js'
fastify.register(materials, { prefix: '/api/materials' })
```

---

## 八、实施步骤

1. 更新 `prisma/schema.prisma`（3张新表）
2. `npx prisma db push`
3. 新建 `src/routes/materials.js`
4. 在 `src/index.js` 注册路由
5. 在 `inventory.js` 的 `/ship` 末尾追加材料扣减（10行）
6. 重构 `frontend/pages/admin-inventory.html`

---

## 九、本期不做

- 渠道配额与订单来源实时同步
- SKU 详情抽屉内关联物料看板（后期迭代，绑定数据库已建好）
- admin-import.html 修改
- production-inventory.html
