# REVENUE.md — 哞屋联名分红体系规划文档

> 本文档记录哞屋（MOWO）平台联名创作者分红体系的完整设计。
> 最后更新：2026-04-05

---

## 一、联名流程

```
创作者认证通过（certifyStatus=2）
  ↓
使用定制工具制作动画机，自己购买收货确认
  ↓
在创作者后台申请联名
  ↓
弹出《MOWOBOX 联名授权协议》
  创作者勾选「我已阅读并同意授权此作品用于 MOWOBOX 实体化生产及销售」
  ↓
管理员审核（检查机械适配性 + 内容合规性）
  ↓
通过 → 作品进入联名库
  → 案例展示页自动显示
  → 小程序可售卖
  ↓
用户购买 → 系统自动计算分红 → 按周结算
```

---

## 二、分红规则

### 2.1 分红公式

```
实际分红率 = BASE_RATE + EXCLUSIVE_BONUS
上限：25%

其中：
  BASE_RATE = max(新手期分红, 活动期分红, 正常期分红)
  EXCLUSIVE_BONUS = 8%（签独家时叠加）
```

### 2.2 新手期

- **条件：** 创作者发布的前3款作品，每款从发布起14天内
- **分红率：** 15%
- **叠加独家：** 可叠加，但总上限25%
- **与活动期：** 取较高者，不叠加
- **第4款起：** 不享受新手补贴，进入正常期

```
示例：
  新手第1款，无活动，无独家 = 15%
  新手第1款，活动20%，无独家 = max(15%, 20%) = 20%
  新手第1款，活动20%，有独家 = 20% + 8% = 28% → 上限25%
  新手第1款，无活动，有独家 = 15% + 8% = 23% ✓
```

### 2.3 活动期

- **条件：** 管理员创建活动（指定时间范围和分红率），创作者上架时选择加入
- **分红率：** 活动指定值（如端午节活动20%）
- **叠加独家：** 可叠加，但总上限25%
- **与新手期：** 取较高者，不叠加
- **活动结束后：** 恢复正常期分红

```
示例：
  活动20%，有独家 = 20% + 8% = 28% → 上限25%
  活动15%，无独家 = 15%（与新手期相同）
  活动10%（低于新手15%），在新手期内 = 取15%
```

### 2.4 正常期

- **公式：** 5% × 牛能系数
- **叠加独家：** 可叠加，无上限限制（最高5%×1.6+8%=16%，不超25%封顶线）

| 牛能等级 | 系数 | 分红率 | +独家 |
|---------|------|-------|-------|
| 1牛能 | 1.0 | 5.0% | 13.0% |
| 2牛能 | 1.1 | 5.5% | 13.5% |
| 3牛能 | 1.2 | 6.0% | 14.0% |
| 4牛能 | 1.4 | 7.0% | 15.0% |
| 5牛能 | 1.6 | 8.0% | 16.0% |

### 2.5 独家协议

- **范围：** 该创作者在平台的**所有作品**独家授权给哞屋
- **含义：** 这些作品在动画机品类只能通过哞屋售卖
- **平台责任：** 负责保护这些作品的版权
- **加成：** +8%，可与新手期/活动期/正常期叠加，总上限25%

### 2.6 分红优先级总结

```
第一步：确定BASE_RATE
  如果在新手期 AND 在活动期 → max(15%, 活动分红率)
  如果只在新手期 → 15%
  如果只在活动期 → 活动分红率
  如果都不在 → 5% × 牛能系数

第二步：叠加独家
  如果签独家 → BASE_RATE + 8%

第三步：封顶
  如果 > 25% → 取25%
```

---

## 三、牛能等级系统

### 3.1 设计原则

- 能升能降，动态调整
- 前几级升级快，高等级升级难
- 长期不活跃会降级
- 具体升降级指标和数值**待后期设计**

### 3.2 数据库预留字段

在 `creator_profiles` 表中预留：
```prisma
bullEnergy        Int     @default(1)    // 牛能等级 1-5
bullEnergyScore   Float   @default(0)    // 牛能积分（升降级依据，具体规则待定）
```

---

## 四、独家协议系统

### 4.1 数据库字段

在 `creator_profiles` 表中预留：
```prisma
isExclusive         Boolean   @default(false)
exclusiveSignedAt   DateTime?
exclusiveExpiredAt  DateTime? // 预留：独家协议到期时间（如需设置有效期）
```

---

## 五、联名作品库

### 5.1 collab_works 表设计

```prisma
model CollabWork {
  id                String    @id @default(uuid())
  creatorId         String
  productId         String?   // 关联products表（如果已上架商品）
  title             String
  description       String?
  coverUrl          String?   // 封面图OSS路径
  animationFrames   String    // JSON数组，帧图片OSS路径
  supportedSkus     String    // JSON数组，支持的SKU ID列表
  
  // 新手期
  isNewbieWork      Boolean   @default(false) // 是否属于前3款
  newbieExpiredAt   DateTime?                 // 新手期截止（发布后14天）
  
  // 活动
  activityId        String?   // 关联活动，null=不参与活动
  
  // 独家（快照，记录审核通过时创作者的独家状态）
  isExclusiveWork   Boolean   @default(false)
  
  // 审核
  status            String    @default("pending") // pending/approved/rejected
  rejectReason      String?
  agreementSignedAt DateTime
  approvedAt        DateTime?
  approvedBy        String?   // 审核管理员userId
  
  // 分红率快照（审核通过时计算并存储，防止后期费率变化影响历史）
  revenueRate       Float     @default(0)
  
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@map("collab_works")
}
```

### 5.2 collab_orders 表设计（联名订单分红记录）

```prisma
model CollabOrder {
  id               String    @id @default(uuid())
  orderId          String    // 关联customize_orders
  collabWorkId     String    // 关联collab_works
  creatorId        String
  
  salePrice        Float     // 实际售价（快照）
  revenueRate      Float     // 本单分红率（快照，防历史记录受影响）
  revenueAmount    Float     // 应付分红金额 = salePrice × revenueRate
  
  settlementStatus String    @default("pending") // pending/settled
  settlementWeek   String?   // 结算周，如「2026-W12」
  settledAt        DateTime?
  
  createdAt        DateTime  @default(now())

  @@map("collab_orders")
}
```

### 5.3 collab_activities 表设计（活动分红）

```prisma
model CollabActivity {
  id           String    @id @default(uuid())
  name         String    // 活动名称，如「端午节联名活动」
  description  String?
  revenueRate  Float     // 活动分红率，如 0.20
  startAt      DateTime
  endAt        DateTime
  isActive     Boolean   @default(true)
  createdBy    String
  createdAt    DateTime  @default(now())

  @@map("collab_activities")
}
```

---

## 六、结算系统

### 6.1 结算周期

- **频率：** 每周结算一次
- **结算标记：** 订单状态为 `shipped`（已发货）后才纳入结算
- **结算周标识：** `2026-W12` 格式

### 6.2 结算流程（待开发）

```
每周固定时间（如周日23:59）
  ↓
系统扫描所有 settlementStatus=pending 且订单已shipped 的 collab_orders
  ↓
按创作者分组汇总应付金额
  ↓
生成结算单（管理员后台查看）
  ↓
管理员确认打款 → 更新 settlementStatus=settled
  ↓
创作者余额增加（写入earnings表）
  → 创作者可在后台查看「待结算」和「已结算」金额
```

### 6.3 创作者数据面板（待开发）

创作者在自己的后台能看到：
- 各作品的浏览量、销售量
- 本周待结算金额
- 历史已结算明细
- 牛能等级和积分

---

## 七、SKU 串联逻辑

```
联名作品 → 在 CRMEB 创建对应商品（带SKU）
  ↓
小程序端用 CRMEB 商品页展示价格和支付
  ↓
支付成功 → CRMEB 回调我们的 API
  ↓
我们 API：
  1. 创建 customize_orders 记录
  2. 创建 collab_orders 记录（计算分红）
  3. 更新库存（如有）
  4. 触发待生产看板显示
```

待生产看板中联名订单显示：
```
「联名款：XXX 作品 · 5x5cm · 12帧 · 椴木板 · 原色」
```

---

## 八、网页端案例展示（showcase.html）

### 8.1 展示内容
- 联名创作者作品卡片（封面图 + 作品名 + 创作者名）
- 点击进入详情页
  - 动画效果展示
  - 作品故事
  - 支持的规格（5x5cm/8x8cm，不显示价格）
  - 按钮：「前往小程序定制此款」（弹出小程序二维码）

### 8.2 不展示的内容
- 价格
- 库存
- 购买按钮（改为二维码引导）
- 评论区（等许可证后上线）

---

## 九、待开发清单

### 已完成 ✅
- collab_works / collab_orders / collab_activities 三张表
- collab_frame_packs 表（联名帧素材包库存，on_demand/stocked）✅ 新增
- creator_profiles 牛能/独家字段
- `GET /api/collab/works` — 联名作品列表（公开）
- `GET /api/collab/works/:id` — 联名作品详情
- `POST /api/collab/apply` — 申请联名
- `PUT /api/admin/collab/:id/approve` — 审核通过/拒绝（含分红率快照计算）
- `PUT /api/admin/collab/:id/shelf` — 上下架 ✅ 新增
- 帧素材包库存接口（GET/PUT/restock）✅ 新增
- creator.js 创作者端路由（查看/上传帧素材）✅ 新增
- admin-collab-works.html 联名作品管理页 ✅ 新增
- admin-collab.html 联名审核页面
- admin-collab-activities.html 活动管理页面
- 分红率自动计算逻辑（revenue.js）

### 待开发（近期）⬜
- showcase.html 联名展示页
- showcase-confirm.html 联名选配下单页
- 创作者管理页面（后端接口已写）
- 联名订单生产流程（复用定制导出地址/录入快递，帧素材走OSS缓存）

### 待开发（中后期）⬜
- 结算系统（按周自动汇总）
- 创作者数据面板
- 牛能升降级逻辑
- CRMEB回调处理
