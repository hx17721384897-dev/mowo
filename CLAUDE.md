# CLAUDE.md — AI 工作守则

> 每次开始新对话前必须先读这个文件。这是哞屋（MOWO / mowobox）项目的核心规范文档。
> 同时必须读 PRODUCTION.md 和 REVENUE.md。

---

## Git 提交规范（必须遵守）

**每完成一个功能模块或修复一个 Bug，必须立即执行一次 commit + push。**

```bash
# 标准流程（每次改完都要执行）
git add .
git commit -m "类型: 简短描述"
git push origin main
```

### Commit 消息格式

```
类型: 主要变更描述

- 文件1: 具体改了什么
- 文件2: 具体改了什么
```

常用类型：
- `feat` — 新功能
- `fix` — Bug 修复
- `refactor` — 重构（不改功能）
- `docs` — 文档更新
- `style` — 样式/UI 调整

### 触发提交的时机

以下情况**必须立即提交**，不能攒着：
1. 一个完整功能开发完成（如：完成购物车分组重构）
2. 一个 Bug 被修复并验证（如：修复编辑器重编辑跳转问题）
3. 每次对话结束前（用户说"好了"/"可以了"等结束语时）
4. 用户主动要求提交时

### 注意事项
- `.env` 文件已在 `.gitignore` 中，**永远不会被提交**，无需担心密钥泄露
- LF/CRLF 换行符警告（Windows 上正常，忽略即可）
- 远程仓库：`https://github.com/huangxiang806/mowo.git`，分支 `main`

---

## 项目简介

**哞屋（mowobox）** 是一个动画机平台，分三个业务层：

1. **定制业务**：用户上传逐帧动画，平台按需生产实体动画机，消费者购买收藏或送礼
2. **联名业务**：认证创作者申请联名，作品审核通过后进入联名库，在小程序/案例展示页售卖，创作者按分红规则获得收益
3. **社群业务**：创作者发布作品和文章，用户互动（待许可证到位后上线）

**Slogan：** 让每帧热爱，都能被触摸。

**品牌信息：**
- 中文品牌名：哞屋 / 哞屋造物
- 英文品牌名：MOWO（产品对外）/ mowobox（商标注册名）
- 网站域名：mowobox.com（规划中）
- API 域名：api.mowo.com（规划中）

---

## 合规策略（重要）

### 前端分阶段交付

**初期版本（当前）：无需EDI证**
- 网页端只做：产品介绍 + 案例展示 + 定制工具
- 网页端不做：社群互动、在线支付、电商购物
- 支付引导至小程序完成（扫码/订单码）
- 社群功能保留代码但不在导航栏显示

**后期版本（许可证到位后）：**
- 社群讨论、文章发布上线
- 网页端支付接入
- 创作者中心全功能开放

### 合规注意事项
- 网页端按钮文案用「前往小程序定制」「查看购买方式」，不用「立即购买」「在线商城」
- 不在网页端集成支付插件
- 社群展示只展示联名作品，不开放评论和交易

---

## 技术栈（不得擅自更改）

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | 纯 HTML5 + CSS3 + 原生 JS (ES6+) | 无框架，无构建工具 |
| 内容后端 | Node.js + Fastify | 端口 3001 |
| ORM | Prisma 5 | 连接 PostgreSQL |
| 数据库1 | PostgreSQL 18 | 本地安装在 D:\huangxiang\app\PostgreSQL\ |
| 数据库2 | MySQL | CRMEB 自带（待配置） |
| 商城后端 | CRMEB 单商户版（PHP） | 只调 API，不改源码（待配置） |
| 文件存储 | 阿里云 OSS | Bucket: mowo-uploads，地域: oss-cn-shanghai |
| 部署 | 阿里云 ECS + Nginx + PM2 | 单台服务器（待部署） |
| 文件上传 | @fastify/multipart | 后端接收图片/视频再转存OSS |

**绝对禁止：**
- 前端引入 React / Vue / Angular 等框架
- 前端引入 Webpack / Vite 等构建工具
- 修改 `crmeb/` 目录下任何源码
- 擅自新增 npm 依赖（需先确认）

---

## 项目目录结构

```
mowo/
├── CLAUDE.md
├── PRODUCTION.md
├── REVENUE.md
├── README.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── FRONTEND.md
│   ├── DATABASE.md
│   └── API.md
│
├── frontend/
│   ├── pages/
│   │   ├── admin-orders.html          ← 管理后台：定制订单（四视图完整重构）✅
│   │   ├── admin-collab-works.html    ← 管理后台：联名作品管理 ✅ 新增
│   │   ├── admin-collab.html          ← 管理后台：联名审核 ✅
│   │   ├── admin-collab-activities.html ← 管理后台：活动管理 ✅
│   │   ├── admin-users.html           ← 管理后台：用户管理 ✅
│   │   ├── admin-logs.html            ← 管理后台：审计日志 ✅
│   │   ├── admin-models.html          ← 管理后台：款式管理（含款式/SKU排序）✅
│   │   ├── admin-inventory.html       ← 管理后台：库存管理 ✅
│   │   ├── production-scan.html       ← 生产端：扫码查询+发货（查询/发货双模式）✅
│   │   ├── production-inventory.html  ← 生产端：库存查看/入库 ⬜ 待开发
│   │   ├── customize-start.html       ← 定制流程：选款式 ✅
│   │   ├── customize-editor.html      ← 定制流程：筛帧 ✅
│   │   ├── customize-confirm.html     ← 定制流程：四步选配+提交（已重构）✅
│   │   ├── showcase.html              ← 联名展示页 ✅ 已完成
│   │   ├── showcase-confirm.html      ← 联名选配下单页 ✅ 已完成
│   │   └── （其他页面保留不删）
│   ├── assets/
│   └── js/
│       └── auth.js
│
├── content-service/
│   ├── src/
│   │   ├── index.js
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── articles.js
│   │   │   ├── users.js
│   │   │   ├── certify.js
│   │   │   ├── animations.js
│   │   │   ├── products.js
│   │   │   ├── earnings.js
│   │   │   ├── feed.js
│   │   │   ├── machine-models.js      ← 含SKU/图片/价格/库存/款式排序/SKU排序
│   │   │   ├── upload.js
│   │   │   ├── customize-orders.js
│   │   │   ├── admin.js               ← 含导出地址/录入快递/导出帧图/扫码查询/扫码发货/批次管理
│   │   │   ├── collab.js              ← 联名系统（公开+创作者端）
│   │   │   ├── admin-collab.js        ← 联名审核+活动管理+上下架+库存
│   │   │   ├── creator.js             ← 创作者端路由 ✅ 新增
│   │   │   └── inventory.js           ← 库存管理
│   │   ├── plugins/
│   │   │   ├── jwt.js
│   │   │   ├── prisma.js
│   │   │   └── oss.js                 ← 新增 ossPresignGet decorator
│   │   └── lib/
│   │       ├── auth.js
│   │       └── revenue.js             ← 新增：分红率计算逻辑
│   ├── prisma/
│   │   └── schema.prisma              ← 36张表
│   ├── src/templates/
│   │   ├── checklist_template.docx    ← 对照清单模板（6列，奇行图片偶行黄底）
│   │   └── barcode_template.docx      ← 条形码清单模板（6列）
│   ├── package.json
│   └── .env
│
└── crmeb/                             ← 只读，不改源码
```

---

## 本地开发环境

### 启动后端服务
```bash
cd content-service
npm run dev
# 服务运行在 http://localhost:3001
```

### 环境变量（.env）
```
DATABASE_URL=postgresql://postgres:Xiang1357999@localhost:5432/mowo_db
JWT_SECRET=mowo_jwt_secret_2026_change_this
OSS_REGION=oss-cn-shanghai
OSS_BUCKET=mowo-uploads
OSS_ACCESS_KEY_ID=（已配置）
OSS_ACCESS_KEY_SECRET=（已配置）
```

### 前端预览
VS Code Live Server，地址 http://127.0.0.1:5500

---

## 前端开发规范

### 设计变量
```css
:root {
  --white:    #FFFFFF;
  --cream:    #F5F3EF;
  --black:    #111110;
  --gray1:    #EBEBEA;
  --gray2:    #C4C3BF;
  --gray3:    #787874;
  --accent-y: #F5E642;
  --accent-o: #FF6B35;
  --accent-g: #8FD694;
  --accent-b: #7EC8E3;
  --font:     'Nunito', 'Noto Sans SC', sans-serif;
  --ease:     cubic-bezier(0.22, 1, 0.36, 1);
}
```

### auth.js 引入规范
```html
<script src="../js/auth.js"></script>
```
导航栏登录按钮：
```html
<button class="nav-login nav-login-btn" id="navLoginBtn">登录</button>
```

### 本地存储 key 约定
```
mowo_token            — JWT 登录 token
mowo_user             — 当前用户信息缓存
mowo_customize_frames — 定制流程帧图数组（提交后清除）
mowo_customize_meta   — 定制流程元数据（提交后清除）
mowo_editor_hint_v2   — 编辑器首次提示标记
mowo_sku_sizes        — 款式管理自定义尺寸选项（localStorage）
mowo_sku_materials    — 款式管理自定义材质选项
mowo_sku_frames       — 款式管理自定义帧数选项
mowo_sku_colors       — 款式管理自定义颜色选项
```

### 断点
- 移动端：< 640px / 平板：640px~1023px / 桌面：≥ 1024px

---

## 后端开发规范

### API 路径约定
```
/api/v1/auth/*           — 账户系统 v1（SMS登录/双Token/logout）[推荐]
/api/v1/user/*           — 账户系统 v1（账号注销等）[推荐]
/api/auth/*              — 注册、登录、用户信息（旧版，保留兼容）
/api/feed                — 社区混合feed流（后期上线）
/api/articles/*          — 文章（后期上线）
/api/users/*             — 用户关注、创作者主页
/api/products/*          — 商品上架/查询
/api/animations/*        — 动画上传/帧图管理
/api/certify/*           — 创作者认证申请
/api/earnings/*          — 收益查询、提现
/api/machine-models/*    — 机型款式及SKU（含管理员增删改）
/api/upload/*            — OSS预签名上传
/api/customize-orders/*  — 定制订单
/api/admin/*             — 管理员后台接口
/api/creator/*           — 创作者端接口 ✅ 新增
/api/collab/*            — 联名系统 ✅ 已完成
/api/inventory/*         — 库存管理 ✅ 已完成
/api/admin/revenue/*     — 分红规则配置（GET role≥2 / PUT role=3）✅ 新增
/api/shop/*              — 转发至 CRMEB（待配置）
```

### JWT Payload
```json
{ "userId": "...", "phone": "...", "certifyStatus": 2, "role": 3 }
```

### 角色权限
```
0 = User        普通用户
1 = Production  生产端（查看订单/下载图纸包/库存入库）
2 = Admin       管理员（全部后台）
3 = SuperAdmin  超级管理员（含审计日志/角色管理）
```

### 响应格式
```json
{ "success": true, "data": {...} }
{ "success": false, "message": "错误描述" }
```

---

## 数据库（43张表）

### 账户安全体系 v1（新增6张）
sms_codes / sms_global_counters / action_tokens / refresh_tokens / token_blacklist / audit_logs

### 已有表
users / user_profiles / credit_scores / credit_logs / certify_applications /
creator_profiles（含牛能/独家字段）/
articles / comments / likes / collects / follows / reports / animations /
products / earnings / balances / withdrawal_requests /
machine_models（含sortOrder款式排序）/
machine_model_skus（含price/previewImage/skuBarcode/sortOrder SKU排序）/
customize_orders（含收件信息/快递信息/inventoryStatus/sourceType/collabWorkId）/
operation_logs /
collab_works（含isOnShelf/framePackOssPath/sizes）/
collab_orders / collab_activities /
sku_inventory / inventory_logs / auth_codes /
shipping_batches（已弃用）

### 本轮新增表（1张）
```
collab_frame_packs  — 联名帧素材包库存（collabWorkId+size唯一，on_demand/stocked）
```

### customize_orders 状态流转
```
pending → paid → locked（导出地址后）→ processing（录入快递后）→ producing（导出帧素材后）→ shipped → received → aftersale / cancelled
```

### SKU全局排序
```
globalSort = 款式.sortOrder × 1000 + SKU.sortOrder
在 admin-models.html 调整顺序后立即影响导出地址排序和帧图压缩包结构
```

### machine_model_skus 重构说明
旧版：一条SKU = 尺寸 + 帧数数组 + 材质 + 颜色数组（多对多，错误设计）
新版：一条SKU = 尺寸 + 材质 + 单个帧数 + 单个颜色（唯一组合，支持独立库存）

---

## 定制流程

```
customize-start.html   选款式（走马灯横向滑动，点「查看详情」看SKU规格）
  ↓ 点「下一步」前：若已登录，调 GET /api/custom-products/quota 检查草稿配额
    配额已满 → alert 提示去「我的动画」删除旧草稿，阻断跳转
  ↓ localStorage: mowo_customize_meta（含 modelId/name/frames/sizes/validTargets）
customize-editor.html  上传→裁剪→提取帧→去重→筛帧
  ↓ 导入文件时（新建流程）：再次调 GET /api/custom-products/quota 二次兜底
    配额已满 → showToast 提示，阻断上传
  ↓ 点「下一步」：若已登录，POST /api/custom-products 保存草稿（状态 draft）
    草稿 ID 存入 localStorage: mowo_customize_draft_id
  ↓ localStorage: mowo_customize_frames
customize-confirm.html 四步选配（帧数→尺寸→材质→颜色，基于单条SKU匹配）
  已选列表支持多款，底部黄色背景显示合计价格
  ↓ 点「立即购买」/「加入购物车」：
    - 若 mowo_customize_draft_id 存在 → PUT 更新该草稿（不新建）
    - 若 mowo_customize_product_map 存在 → PUT 更新已有记录（重试时防重复）
    结果 map 存入 localStorage: mowo_customize_product_map
  ↓ 跳转 checkout.html
  ↓ 清除 localStorage（mowo_customize_frames/meta/draft_id/product_map）
```

### 草稿配额规则
| 角色 | 配额 | 计算范围 |
|------|------|---------|
| 普通用户 | 3 个 | status IN ('draft', 'in_cart') |
| 认证创作者（certifyStatus≥2） | 10 个 | 同上 |

- 配额检查接口：`GET /api/custom-products/quota`（需登录），返回 `{ count, limit, canCreate }`
- **检查时机**：① customize-start.html 点「下一步」时 ② customize-editor.html 导入文件时（仅新建，重新编辑不受限）③ POST /api/custom-products 时（服务端兜底）
- 已提交订单（status='ordered'）、已删除（status='removed'）不计入配额

---

## 用户中心页面清单（普通用户 dropdown 入口）

| 页面 | 功能 | 入口 | 状态 |
|------|------|------|------|
| cart.html | 购物车 | dropdown → 购物车 | ✅ |
| orders.html | 我的订单 | dropdown → 我的订单 | ✅ |
| my-addresses.html | 收货地址管理 | dropdown → 收货地址 | ✅ |
| my-animations.html | 我的动画（定制订单动画预览） | dropdown → 我的动画 | ✅ 新增 |
| settings.html | 账号设置 + 创作者认证入口 | dropdown → 账号设置 | ✅ 新增 |
| favorites.html | 我的收藏 | **初期不挂入口**，文件保留 | ⏸ 待后期社区上线 |

> **dropdown 结构规则（auth.js）：**
> - 所有登录用户：购物车 / 我的订单 / 收货地址 / 我的动画 / 账号设置 / 帮助与反馈 / 退出登录
> - certifyStatus=2（认证创作者）额外显示：**创作者中心** → creator-dashboard.html
> - role≥2（管理员）额外显示：**进入后台** → admin-orders.html
> - "我的动画"（my-animations.html）= 用户定制订单的动画预览，普通页面无侧边栏
> - "我的素材"（creator-animations.html）= 创作者上传的联名动画素材，在创作者中心侧边栏内，两者不同不混淆

## 创作者中心页面清单（certifyStatus=2 专属，侧边栏布局）

| 页面 | 功能 | 状态 |
|------|------|------|
| creator-dashboard.html | 数据总览 + 牛量卡片 | ✅ |
| creator-collab.html | 联名商品管理 | ✅ |
| creator-animations.html | 我的素材（创作者上传的联名动画素材） | ✅ |
| creator-links.html | 引流链接管理 | ✅ |
| creator-earnings.html | 收益与提现 | ✅ |

> **旧版创作者页面（已废弃，保留不删）：** creator-works.html / creator-article-stats.html / creator-product-stats.html / creator-product-edit.html / creator-certify.html（认证申请流程，由 settings.html 链接跳入）

## 管理后台页面清单

| 页面 | 功能 | 权限 | 状态 |
|------|------|------|------|
| admin-orders.html | 定制订单四视图（待处理/处理中/待生产/全部） | role≥2 | ✅ 已重构 |
| admin-collab-works.html | 联名作品管理（上下架/库存/帧图预览） | role≥2 | ✅ 新增 |
| admin-collab.html | 联名作品审核 | role≥2 | ✅ |
| admin-collab-activities.html | 活动管理 | role≥2 | ✅ |
| admin-users.html | 用户列表/角色/封禁 | role≥2 | ✅ |
| admin-logs.html | 审计日志 | role=3 | ✅ |
| admin-models.html | 款式增删改/SKU管理/图片/价格/库存/款式排序/SKU排序 | role≥2 | ✅ 已更新 |
| admin-inventory.html | 库存管理/入库/预警设置 | role≥2 | ✅ |
| admin-revenue-config.html | 分红规则配置（新手期/牛量系数/独家加成/上限） | role=3 写，role≥2 只读 | ✅ 新增 |

## 生产端页面清单（独立于管理后台，role≥1）

| 页面 | 功能 | 状态 |
|------|------|------|
| production-scan.html | 扫码查询+发货双模式，等候区，批次追溯 | ✅ 新增 |
| production-inventory.html | 查看库存/录入入库 | ⬜ 待开发 |

---

## 当前开发进度

### 已完成 ✅
- 定制流程三页（选款式/筛帧/四步选配+提交）
- 定制生产完整流程（导出地址/录入快递/导出帧图压缩包）
- OSS上传（批量预签名URL + 后端代理上传图片）
- 定制订单API（创建/列表/详情）
- 管理后台（订单四视图/联名作品/联名审核/活动管理/用户/日志/款式管理/库存管理）
- 管理员API（统计/订单/生产流程/用户/日志）
- 款式/SKU管理（增删改/图片/价格/库存/款式排序/SKU排序）
- SKU全局排序体系（款式sortOrder×1000 + SKU sortOrder）
- 导出地址新排序规则 + seqNo全局序号
- 帧图压缩包按SKU分文件夹，含对照清单+条形码清单
- 批次管理系统（batchId=YYYYMMDD_HHMMSS）
- production-scan.html 生产端扫码页面（查询/发货/等候区）
- RBAC角色系统（role+JWT+requireRole）
- 审计日志（语义化+IP记录）
- 联名完整后端（审核/活动/上下架/帧素材包库存/创作者端）
- 库存管理后端（含入库/预警/SKU条形码）
- 联络表单系统（contact.html + admin-contact.html）
- **创作者分红结算体系（阶段1）** ✅
  - schema 新增：CreatorReserve / ReserveLog / SettlementRecord
  - settlement.js 路由（管理端结算 + 创作者收益查询）
  - scheduler.js 定时任务（冷却期处理 + 储备金90天解冻）
  - admin-settlement.html 管理端结算页
  - creator-earnings.html 创作者收益明细页
  - creator-dashboard.html 创作者数据总览页
- **牛量系统（阶段2）** ✅
  - schema 新增：PlatformConfig / BullScore / BullScoreLog / CreatorReferralLink / ReferralClick
  - bull.js 路由（管理端牛量管理 + 创作者牛量查询）
  - bull-scheduler.js 每日批处理（三维度积分计算 + 升降级）
  - admin-bull.html 管理端牛量管理页（含参数配置）
  - creator-dashboard.html 侧栏牛量卡片接入真实数据
  - prisma/seed.js 数据库种子文件
- **引流链接 + 商务合同（阶段3）** ✅
  - schema 新增：CreatorSocialLink / CreatorContract（共44张表）
  - links.js 路由（创作者提交外部链接 + 管理端审核）
  - contracts.js 路由（大IP商务合同增删改查 + 打款录入）
  - creator-links.html 创作者引流链接管理页
  - admin-links.html 管理端引流链接审核页
  - admin-contract.html 管理端商务合同页

### 已完成 ✅（购物车 + 地址 + 订单系统）
- 购物车系统全链路（cart.html / checkout.html / cart.js / payment.js）
- 收货地址簿（my-addresses.html / addresses.js / address-utils.js / regions.json）
- checkout.html 地址选择器（已保存地址 + 新地址智能识别 + 联级下拉）
- 导航栏新增"收货地址"入口（auth.js）
- customize-confirm.html goBuy() 改走购物车路由（custom-products → cart/add → checkout）
- **用户订单页接入真实 API** ✅
  - routes/orders.js（GET /api/orders/mine，POST /api/orders/:id/confirm-receipt，GET /api/orders/:id）
  - orders.html 替换全部 mock 数据，接入真实接口，含骨架屏 + 错误重试
  - 状态映射：paid/locked/processing/producing→"制作中"，shipped→"运输中"，received→"已完成"
  - "确认收货"按钮：触发 ColllabOrder 冷却期（创作者分红解锁链路打通）
- docs/DATABASE.md + docs/API.md 完整文档更新
- **联名展示页重构** ✅
  - showcase.html：community.html 视觉体系（瀑布流、搜索、创作者筛选标签、移动端菜单、footer、自定义光标）
  - showcase-confirm.html：work-detail.html 布局（Gallery 画廊+缩略图+方向箭头、sticky 左栏、创作者行）+ SKU 选配/购物车/立即购买 + 大点赞按钮 + 关注创作者按钮
  - collab.js 新增 POST /api/collab/works/:id/like（复用 Like 表 targetType='collab_work'）
  - 列表接口和详情接口均返回 likeCount + isLiked（登录时）
- **order-detail.html 接入真实 API** ✅
  - 从 URL ?id= 读取订单 ID，fetch GET /api/orders/:id
  - 骨架屏加载状态 + 错误重试
  - 状态英雄区：进度条（0-3步）、图标、订单号
  - 商品明细（封面图/productTitle/机型规格/价格）
  - 收货地址（手机号脱敏：138****8888）
  - 支付信息（合计/包邮/下单时间/实付）
  - 评价功能占位（received 状态显示「即将上线」）
  - 操作栏按状态组动态生成（pending/making→取消+客服，shipped→确认收货+客服，done→客服+售后）
  - 取消订单接口 POST /api/orders/:id/cancel（含确认弹窗，paid状态自动解锁库存）
  - 确认收货接口 POST /api/orders/:id/confirm-receipt（含确认弹窗）
  - 联系客服 / 申请退款 / 申请售后：弹出客服企业微信二维码占位弹窗
- orders.html 确认收货加入确认弹窗（避免误触）

### 已完成 ✅（用户中心重构 + Bug修复）
- **auth.js dropdown 重构** ✅
  - 移除：我的收藏、creator-only「数据管理」「我的动画」「我的联名」
  - 新增（全员）：收货地址 → my-addresses.html、我的动画 → my-animations.html
  - 新增（creator-only）：创作者中心 → creator-dashboard.html
  - 账号设置入口指向 settings.html
  - navGoTo 路由表 + navLogout 保护页列表同步更新
- **my-animations.html 新建** ✅
  - 普通用户定制动画列表，标准顶栏布局（无侧边栏）
  - 接入 GET /api/orders/mine，卡片网格展示定制订单
  - 支持「全部/制作中/已发货/已完成」筛选，含骨架屏和错误重试
- **settings.html** ✅（账号设置页，含创作者认证入口）
  - 账号信息区：头像、昵称、手机号（脱敏）+ 修改手机号弹窗（含短信验证）
  - 创作者认证区：4种状态自动渲染（未申请/审核中/已通过/已拒绝）→ 链接 creator-certify.html
  - 账号安全区：退出登录（含确认）
- **creator.js 路由 Bug 修复** ✅
  - 根因：注册前缀 `/api/creator` + 路由内路径 `/creator/…` = 双重 creator，实际路径错误
  - 修复：去掉6条路由路径中的 `/creator` 前缀，恢复为正确的 `/api/creator/collab/…`
- **bull.js creatorProfile 缺失 Bug 修复** ✅
  - 根因：`GET /api/creator/bull/status` 在 creatorProfile 不存在时直接返回 404，导致 dashboard 报错
  - 修复：改为返回默认初始状态（萌牛 Lv.1，积分 0），页面正常渲染不崩溃

### 待开发（高优先级）⬜
- 用户确认收货后的售后申请入口（aftersale 流程）
- 微信支付接入（商户号到位后）
- 订单状态变更短信通知（发货/待付款超时提醒）
- 评价系统（DB设计见下方「待设计」节）

### 待开发（中期）⬜
- ~~showcase.html + showcase-confirm.html 联名展示+下单~~（已完成，见已完成章节）
- 联名订单生产流程
- 牛量升降级规则细化（bullScore 具体计算权重待定）
- 灵活用工平台 API 接入（提现目前为占位）
- Word排版工具（mowo_word.py）
- 正版验证码生成与查询（auth_codes 表已建）
- 库存预警智能分析

### 待开发（后期）⬜
- 社群功能上线（等许可证）
- 小程序：订单码查询+支付+物流
- CRMEB配置
- 服务器部署

---

## 评价系统设计（待实现）

### 数据库表：order_reviews
```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
order_id    UUID NOT NULL UNIQUE REFERENCES customize_orders(id)
user_id     UUID NOT NULL
rating      SMALLINT NOT NULL CHECK(rating BETWEEN 1 AND 5)
content     TEXT
image_urls  TEXT          -- JSON数组，存OSS URL，最多3张
created_at  TIMESTAMPTZ DEFAULT now()
updated_at  TIMESTAMPTZ DEFAULT now()
```

### 业务规则
- 只有 status='received' 的订单才能写评价
- 每个订单只能写一条评价（order_id UNIQUE）
- 评价内容公开展示在联名作品详情页

### API设计（待实现）
```
POST /api/orders/:id/review     提交评价（需登录，仅限 received 状态）
GET  /api/orders/:id/review     查看订单评价
GET  /api/collab/works/:id/reviews  作品评价列表（公开）
```

---

## 重要决策记录

| 决策 | 结论 | 原因 |
|------|------|------|
| 前端分阶段 | 初期只上线展示+定制，社群等许可证 | 合规要求 |
| 支付方式 | 初期订单码+客服微信，后期小程序 | 无EDI证 |
| 社群代码 | 保留不删，等许可证挂载 | 避免重复开发 |
| OSS访问 | 私有Bucket，预签名URL | 防爬虫保护版权 |
| 图片上传 | 后端代理上传（不用前端直传OSS）| 私有Bucket PUT权限限制 |
| 帧图片保护 | Canvas渲染+水印（MOWOBOX·用户ID后8位） | 防盗用 |
| 帧去重 | 感知哈希，取消勾选不删帧 | 保留停顿帧 |
| 防盗尺寸 | 5x5→4.9cm，8x8→7.9cm | 防盗版厂家直接抄尺寸 |
| SKU设计 | 单条SKU=唯一规格组合 | 支持独立库存/条形码/定价 |
| 条形码体系 | 三码分离（SKU码/订单码/正版码）| 生产/发货/防伪三个场景各自独立 |
| 分红品牌 | 牛能等级（能升能降） | 品牌一致性 |
| 分红结算 | 按周结算，审核时快照revenueRate | 创作者体验+历史数据稳定 |
| SKU全局排序 | 款式sortOrder×1000 + SKU sortOrder | 跨款式统一排序，admin-models.html调整即生效 |
| 导出地址排序 | 最高优先级SKU→订单少→最早下单 | 生产顺序和打单顺序一致，减少囤积 |
| 帧图压缩包 | 按SKU分文件夹，模板填充对照/条形码清单 | 生产时按SKU批量处理，不混淆 |
| 批次系统 | 已弃用shipping_batches，改为直接按收件人 | 流程简化 |
| 联名帧素材库存 | on_demand按需/stocked有备货 | 材料包是硬门槛，帧素材包软性 |
| 文档填充方式 | adm-zip操作XML插入图片/文字 | 不依赖模板路径，格式可控 |
| customize-confirm | 四步独立选配（帧数→尺寸→材质→颜色）| 基于单条SKU匹配，逻辑清晰 |
| 草稿配额拦截时机 | 在 customize-start「下一步」和 editor 导入文件时前置检查，不等到提交才报错 | 用户编辑完才报上限体验极差，前置拦截节省用户时间 |
| 草稿配额数量 | 普通用户3个，认证创作者10个 | 防止草稿堆积占用存储，创作者高频使用给更大空间 |
| 导出地址排序规则 | 单款排前→多款按最高SKU→同SKU按数量少→逐位比较次高SKU | 生产顺序和打单顺序严格一致，打包时多款用户无需手动匹配 |
| seqNo | 导出地址时写入，帧图压缩包按seqNo排序 | 两次导出顺序永远一致，不依赖重新计算 |
| 批次ID格式 | YYYYMMDD_HHMMSS（精确到秒）| 防止同分钟内多次导出冲突 |
| 批次冷却 | 导出地址按钮5秒冷却 | 防误触产生孤立小批次，新订单等下次主动导出时合并 |
| 批次下拉过滤 | 各状态视图只显示该状态有订单的批次 | 避免干扰，一眼看出当前需要处理哪些 |
| 等候区设计 | 未配齐快递单跳过→等候区，被扫到时弹出确认快递面单 | 防误打包，确认归属后自动回到当前单 |
| 牛量系统名称 | 改名为「牛量」（原牛能），等级：萌牛/勤牛/红牛/神牛/牛王 | 品牌升级 |
| 牛量积分刷新 | 每天凌晨3点批处理，不实时计算 | 爬虫依赖24小时周期，实时无意义 |
| 等级阈值存储 | 所有阈值存 platform_configs 表，管理后台可调 | 灵活调整，不改代码 |
| 降级机制 | 连续2个月不达标降一级 | 平滑不突兀，避免单次波动误降 |
| 声量维度初期 | 创作者填链接，管理员审核后手动填播放量和加成系数 | 爬虫成本高，先走人工再自动化 |
| 储备金比例 | 初期固定15%，阶段2牛量接入后动态分档 | 先跑通流程，后期精细化 |
| 结算冷却期 | 收货后15天，等阶段2牛量接入再按等级动态缩短 | 保守安全，后期激励创作者 |
| 大IP合同 | 独立 creator_contracts 表，不走标准分红体系 | 商务单独管理，系统只做记录 |
| 推广链接 | 每个创作者一条专属链接，格式 mowobox.com?ref=xxx | 归因清晰，防冒充 |
| 我的收藏 | 初期不挂 dropdown 入口，favorites.html 文件保留 | 初期无社区/联名 SKU 数量少，收藏无意义；待 SKU≥20+ 且社区上线后再配合消息通知一起加 |
| 动画页命名 | "我的动画"=用户定制订单预览(my-animations.html)；"我的素材"=创作者联名素材管理(creator-animations.html) | 两个东西本质不同，改名避免混淆，杜绝双入口困惑 |
| 创作者认证入口 | 放在 settings.html 账号设置页内 | 认证是账号属性，流程完成后 dropdown 自动出现创作者中心入口，和管理员看进入后台逻辑一致 |
| dropdown 菜单重构 | 去掉收藏/数据管理/我的联名/creator-only动画，统一为：购物车/订单/地址/动画/[创作者中心]/[进入后台]/账号设置 | 普通用户和创作者功能空间分离，入口清晰不冗余 |
