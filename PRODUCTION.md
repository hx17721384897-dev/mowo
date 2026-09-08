# PRODUCTION.md — 哞屋生产管理系统规划文档

> 本文档记录哞屋（MOWO）平台从用户下单到实体产品发货的完整生产管理系统设计。
> 最后更新：2026-04-06

> **文档状态（2026-09-08）：历史规划，不是当前操作说明。** 当前材料包款已形成统一 `SO -> PU -> PB -> FP`、打印、领料、配对、装箱和发货闭环，详见 `docs/PRODUCTION_BATCH_WORKFLOW.md` 和 `docs/modules/admin-production.md`。下文人工收款、CRMEB、旧批次、旧状态和旧页面均已失效，只保留为设计来源；不得据此恢复第二套生产系统。本文件将在独有原则迁入当前专题后压缩或删除。

---

## 一、整体生产流程

```
用户在网页完成定制选配
  ↓
帧图片上传OSS → 创建定制订单（status: pending）
  ↓
用户获取订单号 → 添加客服微信人工支付
  ↓
管理员确认收款 → 手动将订单状态改为 paid（已支付）
  ↓（后期接CRMEB自动支付后此步骤自动触发）

管理员在 admin-orders.html【待处理视图】
  ↓
导出收件地址（CSV+XLSX，按SKU全局优先级+订单数量排序，每行一单）
  → 自动触发：订单状态改为 locked（地址已导出）
  ↓
打印快递面单，录入快递单号（格式：订单号,快递公司,快递单号）
  → 自动触发：订单状态改为 processing（快递已录入）
  ↓
勾选订单，导出帧素材包ZIP
  → 按SKU分文件夹（款式_帧数_尺寸_材质_颜色/序号_订单号/帧图）
  → 含对照清单.docx + 条形码清单.docx（模板填充）
  → 自动触发：订单状态改为 producing（生产中）
  ↓
本地运行 mowo_process.py 处理帧图片 → 排版到Word模板 → 打印
  ↓
扫码配对（快递面单条码 → 检测配齐状态 → 确认发货）
  ↓（production-scan.html，待开发）
组装完成 → 确认发货 → 状态改为 shipped（已发货）
```

---

## 二、订单状态流转

| 状态 | 说明 | 触发方式 |
|------|------|---------|
| `pending` | 待支付 | 用户提交定制后自动创建 |
| `paid` | 已支付 | 管理员手动确认（后期CRMEB自动） |
| `locked` | 地址已导出 | 管理员导出收件地址时自动触发 ✅ 新增 |
| `processing` | 快递已录入 | 管理员录入快递单号时自动触发 ✅ 新增 |
| `producing` | 生产中 | 管理员导出帧素材包时自动触发 |
| `shipped` | 已发货 | 生产端确认发货后触发 |
| `received` | 已签收 | 用户确认或物流自动触发（预留） |
| `aftersale` | 售后处理中 | 管理员手动标记 |
| `cancelled` | 已取消 | 管理员手动标记 |

---

## 三、管理后台模块

### 3.1 已完成 ✅

**定制订单管理页面（admin-orders.html）—— 完整重构**
- 四视图：待处理（paid）/ 处理中（locked）/ 待生产（processing）/ 全部
- 待处理视图：按收件人分组，导出收件地址（CSV+XLSX打包zip）
- 处理中视图：批量粘贴快递单号（格式：订单号,快递公司,快递单号）
- 待生产视图：勾选订单，导出帧素材包zip
- 全部视图：完整订单列表，支持搜索和状态筛选
- 侧边栏下拉菜单，侧边栏badge显示各状态数量
- 右侧抽屉查看订单详情（含帧图预览）

**后端API（/api/admin/）—— 新增生产流程接口**
- `GET  /stats` — 订单统计（各状态数量）
- `GET  /orders` — 订单列表（支持分页、状态筛选）
- `GET  /orders/:orderNo` — 订单详情（含OSS预签名下载链接）
- `PUT  /orders/:orderNo/status` — 更新订单状态
- `PUT  /orders/batch-status` — 批量更新状态
- `POST /orders/export-address` — 导出收件地址（按SKU全局优先级+订单数量排序，→locked）✅ 新增
- `POST /orders/import-tracking` — 批量录入快递单号（→processing）✅ 新增
- `POST /orders/batch-export-frames` — 导出帧素材包ZIP（按SKU分文件夹，→producing）✅ 新增
- `GET  /users` — 用户列表
- `PUT  /users/:id/role` — 修改用户角色（仅SuperAdmin）
- `PUT  /users/:id/ban` — 封禁/解封用户
- `GET  /logs` — 审计日志（仅SuperAdmin）

**款式排序与SKU排序（admin-models.html）✅ 新增**
- 工具栏「↕ 调整款式顺序」：调整款式间优先级
- 款式内「↕ 调整SKU顺序」：调整SKU内顺序
- globalSort = 款式.sortOrder × 1000 + SKU.sortOrder
- 排序保存后立即影响导出地址排序和帧图压缩包结构

**帧素材包ZIP结构 ✅ 新增**
```
时间戳_frames.zip
├── 对照清单/时间戳_对照清单.docx     ← 模板填充，6列，奇行图片偶行黄底订单号
├── 条形码清单/时间戳_条形码清单.docx  ← 模板填充，6列，单行条形码
├── 常规机型_12帧_5×5cm_椴木板_原色/
│   ├── 01_ORD_XXX/（帧图片）
│   └── 02_ORD_XXX/
└── 常规机型_16帧_5×5cm_椴木板_原色/
    └── 01_ORD_XXX/
```

**导出地址排序规则 ✅ 新增**
```
第一优先：收件人拥有的最高优先级SKU（globalSort最小）
第二优先：该收件人订单数量少的排前（更容易在本批次凑齐打包）
第三优先：最早下单时间
每行一个订单（不合并同收件人），顺序与生产顺序完全一致
```

**审计日志系统**
- `operation_logs` 表自动记录所有 POST/PUT/DELETE 操作
- 字段：userId、userRole、method、path、action（语义化）、targetId、before、after、ip
- 示例记录：`管理员A 将订单 ORD123 状态从「待支付」修改为「已支付」`
- IP字段用于安全审计，未来多人协作时可追溯异地操作

**联名作品管理（admin-collab-works.html）✅ 新增**
- 联名作品卡片展示，状态筛选
- 上下架操作
- 抽屉详情：帧图预览 + 帧素材包库存管理
- 帧素材包可设置 on_demand（按需）/ stocked（有备货）

### 3.2 待开发 ⬜

**生产端扫码发货（production-scan.html）**
- 扫快递面单条形码 → 显示该面单下所有订单
- 每个订单显示SKU规格 + 生产状态
- 检测配齐状态：未配齐→等待区，配齐→提示可发货
- 确认发货 → 状态改为 shipped

**用户收件地址填写流程**
- 用户提交定制时填写收件信息（姓名/电话/城市/地址）
- 目前测试用SQL手动填写，正式流程待开发

**订单付款流程**
- 目前提交定制后订单直接是paid
- 正式流程：pending→小程序付款→CRMEB回调→paid

---

## 四、API 规范

### 4.1 通用响应格式

```json
{ "success": true,  "data": {...} }
{ "success": true,  "message": "操作成功" }
{ "success": false, "message": "错误描述" }
```

### 4.2 错误码定义

| HTTP状态码 | 含义 | 常见场景 |
|-----------|------|---------|
| 400 | 请求参数错误 | 缺少必填字段、状态值非法 |
| 401 | 未登录 | token不存在或已过期 |
| 403 | 权限不足 | role不够、操作他人数据 |
| 404 | 资源不存在 | 订单号不存在、用户不存在 |
| 500 | 服务器内部错误 | 数据库异常、OSS异常 |

### 4.3 认证方式

```
Header: Authorization: Bearer <JWT token>
Token有效期：7天
Token Payload: { userId, phone, certifyStatus, role }
```

---

## 五、下载图片包设计

### 5.1 ZIP包结构

```
ORD1774075464586428_frames.zip
└── ORD1774075464586428/
    ├── config.json          ← 程序读取（订单ID、SKU、款式编码）
    ├── 订单信息.txt           ← 人工查看（规格、下单时间、用户）
    ├── barcode.png          ← 订单条形码贴纸（打印贴在材料包装袋上）
    ├── 处理说明.txt           ← 告诉你运行什么命令、用哪个Word模板
    └── 原始帧/
        ├── 001.jpg
        ├── 002.jpg
        └── ...012.jpg
```

### 5.2 config.json 格式

```json
{
  "orderNo":    "ORD1774075464586428",
  "userId":     "1aad51bc",
  "modelName":  "常规机型",
  "skuId":      "a91d68f6-8e5b-452d-9aa4-ffce69069029",
  "skuCode":    "MOWO-5x5-12F-BASS-NAT",
  "frameCount": 12,
  "size":       "5x5cm",
  "material":   "椴木板",
  "color":      "原色",
  "template":   "5x5cm_12帧",
  "createdAt":  "2026-03-21 14:30:00"
}
```

### 5.3 处理说明.txt 格式

```
订单号：ORD1774075464586428
规格：5x5cm · 12帧 · 椴木板 · 原色

处理步骤：
1. 运行图片处理脚本：
   python mowo_process.py --input 原始帧 --output 处理后帧 --size 5x5 --frames 12

2. 打开Word模板：5x5cm_12帧.docx

3. 打印并裁切页片

4. 将 barcode.png 打印贴在材料包装袋上
```

### 5.4 条形码贴纸（barcode.png）

- **格式：Code128**（比QR码更适合细长型贴纸，扫码枪识别速度更快）
- 内容：订单号（ORD1774075464586428）
- 尺寸：约8cm × 2cm，适合普通A4打印机
- 包含文字：订单号 + 规格摘要（5x5cm·12帧·椴木板） + 下单日期
- 用途：贴在材料包装袋上，扫码枪扫描配对

### 5.5 下载触发逻辑

```
管理员点击「下载图片包」
  → 后端查询订单信息
  → 生成 config.json、订单信息.txt、处理说明.txt
  → 用 jsbarcode + canvas 生成 barcode.png
  → 打包所有原始帧图片
  → 自动将订单状态改为 producing（生产中）
  → 自动虚拟锁定对应SKU库存（后期接库存系统后生效）
  → 写入审计日志
  → 返回ZIP文件流
```

---

## 六、本地图片处理工具

### 6.1 mowo_process.py（已完成）

**功能：** 将原始帧图片处理成动画机可用的页片图片

**处理流程：**
```
输入：N张原始帧图片
  ↓
分割拼接：
  页片i = 第i帧上半 + 白色折痕（0.4mm） + 第i+1帧下半
  （最后一帧的下半连接第一帧，形成循环）
  ↓
加角标：右下角小字序号（2mm），自适应背景色
  深色背景 → 白色文字+黑色描边
  浅色背景 → 黑色文字+白色描边
  ↓
输出：N张处理好的页片图片（300dpi，JPEG quality=95）
```

**使用命令：**
```bash
python mowo_process.py --input 原始帧文件夹 --output 输出文件夹 --size 5x5 --frames 12
```

**防盗版设计：**
- 5x5cm → 实际生产尺寸4.9cm
- 8x8cm → 实际生产尺寸7.9cm
- 盗版厂家直接抄标称尺寸，页片会松动或卡死

### 6.2 Word排版工具（待开发）

**模板规格对应表：**

| 规格 | 表格布局 | 页数 |
|------|---------|------|
| 5x5cm · 12帧 | 3行×4列 | 1页 |
| 5x5cm · 16帧 | 4行×4列 | 1页 |
| 5x5cm · 24帧 | 3行×4列 | 2页 |
| 8x8cm · 12帧 | 待确认 | 2页 |
| 8x8cm · 16帧 | 待确认 | 待确认 |
| 8x8cm · 24帧 | 待确认 | 待确认 |

---

## 七、生产驱动看板设计（待开发）

### 7.1 核心目标

**解决「今天要生产什么，要生产多少」的问题。**

### 7.2 汇总逻辑

```
扫描所有 status=paid 的订单
  ↓
按「size + frameCount + material + color」分组汇总
  ↓
显示：
  5x5cm · 12帧 · 椴木板 · 原色  →  5单待生产 / 库存3套 / 还差2套
  8x8cm · 24帧 · 椴木板 · 原色  →  2单待生产 / 库存5套 / 充足
```

### 7.3 页面功能

**汇总区（生产计划）：**
- 按款式分组，显示待生产数量
- 后期接库存系统后显示库存/锁定/缺口数量
- 点击款式筛选查看该款式的所有待生产订单

**任务列表：**
- 显示所有 paid 状态订单
- 每条显示：订单号、用户昵称、规格、下单时间、第一帧预览图
- 支持勾选多个订单批量操作

**批量下载图纸包：**
- 勾选订单 → 点击「批量下载图纸包」
- 弹出确认框说明数量和后续影响
- 确认后批量生成ZIP并下载
- 自动改状态为producing + 锁定库存

### 7.4 需要新增的后端API

```
GET  /api/admin/production/summary
  → 按款式汇总待生产订单数量和库存情况

GET  /api/admin/production/orders
  → 待生产订单列表（含第一帧预览URL）

POST /api/admin/production/batch-download
  → 批量生成ZIP + 状态改为producing + 锁定库存
```

### 7.5 第一帧预览实现

```javascript
// 后端查询订单的 frameUrls 字段
const frameKeys = JSON.parse(order.frameUrls || '[]')
const previewUrl = frameKeys.length > 0
  ? fastify.oss.signatureUrl(frameKeys[0], { expires: 3600 })
  : null
// 返回给前端直接展示
```

---

## 八、智能仓储与扫码系统（后期开发）

### 8.1 设计思路

**核心：扫码枪模拟键盘 + 网页版生产工作台（无需本地程序）**

优势：
- 任何电脑开浏览器即用，零安装
- 云端更新代码，所有设备立即生效
- 和管理后台共用同一套API和登录系统
- 手机也能用，仓库灵活性更高

### 8.2 库存锁定机制

**防止并发订单竞争同一套材料包：**

```
管理员A点击下载图片包（订单X，SKU=5x5·12帧）
  → 系统虚拟锁定1套该SKU库存
  → 看板显示：库存5套 / 锁定1套 / 可用4套

管理员B同时查看看板
  → 看到可用库存是4套（而不是5套）
  → 不会误以为有5套可用

扫码配对完成
  → 锁定转为实际出库：库存-1 / 锁定-1
  → 最终：库存4套 / 锁定0套 / 可用4套
```

数据库字段设计：
```
Inventory:
  quantity      Int  // 总库存
  lockedQty     Int  // 虚拟锁定数量（已下载图片包但未扫码配对）
  availableQty  Int  // 可用数量 = quantity - lockedQty（计算字段）
```

### 8.3 扫码操作流程

```
生产工作台页面（role=1 生产端可访问）

入库操作：
  扫材料包条码（SKU编码）→ 输入数量 → 确认入库
  → Inventory.quantity + N
  → 写入 inventory_logs（type: in）

出库配对操作：
  扫订单条码（订单号）→ 显示订单详情和所需SKU
  扫材料包条码（SKU编码）→ 后端校验SKU是否与订单匹配

  ✅ 匹配成功：
    → Inventory.quantity - 1 / lockedQty - 1
    → 写入 inventory_logs（type: out）
    → 订单状态改为 done（已完成）

  ❌ SKU不匹配（防呆机制）：
    → 网页端弹出全屏红色警告
    → 播放错误音效（Web Audio API）
    → 显示：「材料包不匹配！订单需要 [正确SKU]，扫入的是 [错误SKU]」
    → 必须点击「我知道了」才能继续操作
    → 写入审计日志（type: warning）
```

### 8.4 条形码规范

**订单条码（随ZIP包生成）：**
- 格式：Code128（适合细长贴纸，扫码枪识别速度快）
- 内容：订单号（ORD1774075464586428）
- 生成时机：下载图片包时随ZIP一起生成为barcode.png

**材料包条码（管理员后台生成）：**
- 格式：Code128
- 内容：SKU编码（如 MOWO-5x5-12F-BASS-NAT）
- 命名规则：MOWO-{尺寸}-{帧数}F-{材质缩写}-{颜色缩写}
- 生成时机：管理员在后台为每种SKU生成，打印贴在预制材料包上
- 建议一次打印多张同款条码备用

### 8.5 需要新增的数据库表

```prisma
model Inventory {
  id           String   @id @default(uuid())
  skuId        String   @unique
  skuCode      String   // 人类可读编码，如 MOWO-5x5-12F-BASS-NAT
  quantity     Int      @default(0)  // 总库存
  lockedQty    Int      @default(0)  // 虚拟锁定数量
  updatedAt    DateTime @updatedAt
  @@map("inventory")
}

model InventoryLog {
  id         String   @id @default(uuid())
  skuId      String
  skuCode    String
  type       String   // in=入库 out=出库 lock=锁定 unlock=解锁
  quantity   Int
  orderId    String?  // 出库/锁定关联的订单
  operatorId String
  note       String?
  createdAt  DateTime @default(now())
  @@map("inventory_logs")
}
```

---

## 九、技术架构总结

### 9.1 角色权限

| Role | 名称 | 可访问模块 |
|------|------|---------|
| 0 | 普通用户 | 前台所有页面 |
| 1 | 生产端 | 生产工作台、订单详情查看、ZIP下载 |
| 2 | 管理员 | 全部后台（除审计日志） |
| 3 | 超级管理员 | 全部权限（含审计日志、角色管理） |

### 9.2 数据库表（已建，共36张）

| 表名 | 用途 | 状态 |
|------|------|------|
| users | 用户账号（含role字段） | ✅ |
| user_profiles | 用户资料 | ✅ |
| credit_scores | 信用分 | ✅ |
| credit_logs | 信用分变动记录 | ✅ |
| certify_applications | 创作者认证申请 | ✅ |
| creator_profiles | 创作者资料（含牛能/独家字段） | ✅ |
| articles | 文章 | ✅ |
| comments | 评论 | ✅ |
| likes | 点赞 | ✅ |
| collects | 收藏 | ✅ |
| follows | 关注 | ✅ |
| reports | 举报 | ✅ |
| animations | 动画 | ✅ |
| products | 商品 | ✅ |
| earnings | 收益记录 | ✅ |
| balances | 余额 | ✅ |
| withdrawal_requests | 提现申请 | ✅ |
| machine_models | 机型款式（含sortOrder） | ✅ |
| machine_model_skus | 款式SKU（含price/previewImage/skuBarcode/sortOrder） | ✅ |
| customize_orders | 定制订单（含收件信息/快递/inventoryStatus/locked/processing状态） | ✅ |
| operation_logs | 审计日志 | ✅ |
| collab_works | 联名作品库（含isOnShelf/framePackOssPath/sizes） | ✅ |
| collab_orders | 联名订单分红记录 | ✅ |
| collab_activities | 活动分红 | ✅ |
| collab_frame_packs | 联名帧素材包库存（按作品+尺寸，on_demand/stocked）| ✅ 新增 |
| sku_inventory | SKU材料包库存（含安全库存/最大订单限制） | ✅ |
| inventory_logs | 出入库/锁定记录 | ✅ |
| auth_codes | 正版验证码（预留） | ✅ |
| shipping_batches | 发货批次（已弃用，保留表结构） | 弃用 |

### 9.3 OSS新增路径

联名帧素材包：
```
collab-frames/{collabWorkId}/{size}.zip
```

### 9.4 OSS存储结构

```
mowo-uploads/（私有Bucket，所有访问通过预签名URL）
├── customize/
│   └── {userId后8位}/
│       └── {tempOrderNo}/
│           └── 001.jpg ~ 024.jpg
└── avatars/
    └── {userId后8位}/
        └── {timestamp}.jpg
```

---

## 十、当前开发进度

### 已完成 ✅

- 定制流程前端三页（选型号 → 筛帧 → 四步选配）
- 帧图片上传OSS（预签名URL批量上传）
- 创建定制订单API
- 管理后台订单管理页面（admin-orders.html）完整重构，四视图
- 定制完整生产流程：导出地址 → 录入快递 → 导出帧素材包
- 帧素材包ZIP按SKU分文件夹，含对照清单+条形码清单（模板填充）
- SKU全局排序体系（款式sortOrder×1000 + SKU sortOrder）
- 导出地址按SKU优先级+订单数量排序，每行一单
- 款式管理（增删改/图片/价格/库存/款式排序/SKU排序）
- 联名后端完整（审核/活动/上下架/帧素材包库存）
- admin-collab-works.html 联名作品管理页
- creator.js 创作者端路由
- collab_frame_packs 表（联名帧素材包库存）
- RBAC角色系统（role字段 + JWT + requireRole中间件）
- 审计日志系统（自动hook + 语义化记录 + IP记录）
- mowo_process.py 帧图片处理脚本（分割/拼接/折痕/角标）
- **production-scan.html 生产端扫码页面** ✅ 新增
  - 查询模式：扫材料包码/订单码/快递单号，自动识别类型
  - 发货模式：扫快递面单→逐件扫订单码确认→配齐后确认发货→shipped
  - 等候区：未配齐跳过→红点提示，等候区订单被扫到时自动弹出确认
  - 侧边栏布局，可折叠
- **批次管理系统** ✅ 新增
  - 批次ID = 导出地址时刻（YYYYMMDD_HHMMSS，精确到秒）
  - 所有订单绑定批次ID（batchId字段），贯穿全生产流程
  - 文件命名统一：YYYYMMDD_HHMMSS_收件地址.zip / _frames.zip
  - 处理中/待生产视图批次下拉：只显示该状态有订单的批次
  - 全部订单视图批次下拉：显示所有批次，🟠进行中/🟢已完成状态灯
  - 生产中/已发货等视图批次下拉：只显示该状态有订单的批次
  - 导出地址按钮5秒冷却防误触，防止生成孤立小批次
- **新排序规则** ✅ 新增
  - 单款用户全部排前，多款用户排后
  - 组内按最高优先级SKU排
  - 多款组内同最高优先级时，购买数量少的排前
  - 同数量时按第二高优先级SKU排（依此类推）
- **seqNo 全局序号** ✅ 新增
  - 导出地址时写入订单 seqNo，帧图压缩包按 seqNo 排序
  - 确保快递面单顺序与帧图压缩包文件夹顺序完全一致
- **扫码查询后端接口** ✅ 新增
  - `GET /api/admin/scan/sku/:barcode` — 材料包规格查询
  - `GET /api/admin/scan/order/:orderNo` — 订单信息+配齐状态查询
  - `GET /api/admin/scan/tracking/:trackingNo` — 快递单下所有订单查询
  - `POST /api/admin/scan/confirm-order` — 确认单个订单归属
  - `POST /api/admin/scan/ship-tracking` — 确认快递单发货（→shipped）
- **批次列表后端接口** ✅ 新增
  - `GET /api/admin/batches?status=xxx` — 批次列表（支持按状态过滤）
  - `GET /api/admin/batches/:batchId/stats` — 单批次统计

### 待开发（高优先级）⬜

- **收件地址填写** 用户提交定制时填写收件信息（目前SQL手动填）
- **付款流程** 对接小程序付款后状态变paid（目前提交即paid）

### 待开发（中期）⬜

- 创作者管理页面（后端接口已写）
- showcase.html + showcase-confirm.html 联名展示+下单
- 联名订单生产流程
- Word排版工具（mowo_word.py，python-docx）
- 正版验证码生成与查询（auth_codes 表已建）

### 待开发（后期）⬜

- 智能仓储扫码系统（库存表 + 扫码工作台页面）
- CRMEB配置（小程序支付）
- 服务器部署（阿里云ECS + Nginx + PM2）
- 社群功能（等许可证）

---

## 十一、本地工具使用指南

### mowo_process.py

```bash
# 基本用法
python mowo_process.py --input 原始帧 --output 输出文件夹 --size 5x5 --frames 12

# 示例（Windows）
python mowo_process.py ^
  --input "C:\mowo_tools\ORD123\原始帧" ^
  --output "C:\mowo_tools\ORD123\处理后帧" ^
  --size 5x5 ^
  --frames 12
```

### 依赖安装

```bash
pip install Pillow
```

### 输出文件说明

- 命名：001.jpg、002.jpg...（三位数字补零）
- 分辨率：300dpi（印刷标准）
- 格式：JPEG，quality=95
- 内容：页片拼接 + 白色折痕（0.4mm）+ 角标序号（2mm，自适应色+描边）
