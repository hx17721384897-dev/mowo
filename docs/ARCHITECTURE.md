# ARCHITECTURE.md — 整体架构说明

> **文档状态（2026-08-12）：早期目标架构，不是当前部署或首发基线。** `crmeb/` 目前只有占位文件，首发已决定采用精简自建订单系统和微信官方支付能力，不重新引入 CRMEB。小程序已有 uni-app/Vue/Pinia 骨架但核心交易页面尚未闭环；社区与线上分红/牛量/提现首发关闭。下文原架构图和数据流保留用于追溯，当前有效口径请先读 `PROJECT_INDEX.md`、`OPEN_QUESTIONS.md` 和 `modules/operations-quality.md`。

## 系统架构图

```
用户浏览器
     │
     ▼
  Nginx :80/:443
  (阿里云 ECS)
     │
     ├── /                  → frontend/pages/        (静态 HTML)
     ├── /js/*              → frontend/js/           (公共JS)
     ├── /api/*             → content-service :3001   (Node.js)
     └── /api/shop/*        → CRMEB :8080             (PHP，待配置)

外部服务：
  ├── 阿里云 OSS（mowo-uploads，上海，私有）
  │     └── 用途：定制帧图、头像、动画帧
  ├── 微信小程序（待开发）
  │     └── 用途：支付、订单码查询、社群互动
  ├── CRMEB（待配置）
  │     └── 用途：商品SKU、购物车、微信支付
  └── 腾讯云实名认证（待接入）
        └── 用途：创作者身份核验
```

---

## 三端职责划分

### frontend/（纯静态）
- HTML页面，CSS/JS全部内联
- 唯一公共文件：`js/auth.js`（登录状态管理）
- 通过 fetch 调用 content-service API
- 初期只展示：产品介绍 + 案例展示 + 定制工具
- 社群/购物等页面代码保留，等许可证后挂载

### content-service/（Node.js + Fastify，端口3001）
负责平台所有业务逻辑：
- 用户注册、登录、JWT签发（7天有效期）
- 创作者认证申请与审核
- 文章、社区内容管理（后期上线）
- 动画内容上传与帧图管理
- 创作者商品上架配置
- 收益记录、提现申请
- 机型款式及SKU管理
- OSS预签名URL生成
- 定制订单创建与管理
- 管理员后台接口（订单/生产完整流程/用户/日志）
- 联名系统（审核/活动/上下架/帧素材包库存/创作者端）

### crmeb/（PHP，只调用不修改）
负责标准电商流程（待配置）：
- 商品SKU管理
- 购物车、下单
- 微信支付/支付宝
- 物流信息

### 小程序（待开发）
- 订单码查询（输入订单号显示定制详情）
- 支付闭环（微信支付）
- 物流信息填写
- 社群互动（后期）

---

## 合规架构设计

```
网页端（展示+工具）← 无需EDI证
  ├── 产品介绍
  ├── 案例展示（联名作品，无评论无购买）
  └── 定制工具（上传帧图、生成订单号）
           ↓ 显示订单号+小程序二维码
小程序端（交易+互动）← 微信生态合规
  ├── 输入订单号/扫码识别
  ├── 确认规格+支付
  └── 物流信息填写
           ↓ 支付成功回调
content-service（统一处理）
  ├── 更新订单状态（paid）
  ├── 计算联名分红
  └── 触发生产看板
```

---

## 数据流说明

### 定制购买流程（当前）
```
Vue /app/customize → Vue /app/customize/editor → Vue /app/customize/confirm
  → 私有素材/帧图经预签名 URL 上传
  → 服务端确认定制状态并以幂等键加入 CUSTOM 购物车
  → cart.html → checkout.html
  → POST /api/cart/checkout 创建不可变 PreOrder 快照并预留库存
  → 当前真实支付关闭；后续由微信小程序支付交接完成付款
```

### 定制购买流程（后期接小程序）
```
同上 → Web 结算生成 PreOrder
  → 微信小程序读取本人待支付记录并发起支付
  → 可信微信支付回调验签、核对商户订单和金额
  → content-service 幂等转为已支付销售订单
  → 待生产看板自动显示
```

### 联名作品购买流程（待开发）
```
showcase.html → 点「前往小程序定制此款」
  → 用户扫码进小程序 → 显示联名作品详情
  → 用户确认规格 → 支付
  → CRMEB回调 → content-service
    → 创建customize_orders
    → 创建collab_orders（计算分红）
    → 待生产看板显示「联名款：XXX作品」
```

### 生产流程（已实现）
```
管理员在 admin-orders.html
  待处理视图：导出收件地址ZIP（CSV+XLSX，按SKU全局优先级+订单数量排序）→ locked
  处理中视图：批量录入快递单号（格式：订单号,快递公司,快递单号）→ processing
  待生产视图：勾选订单 → 导出帧素材包ZIP → producing
    ZIP结构：对照清单/ + 条形码清单/ + 按SKU分文件夹（序号_订单号/帧图）
  本地运行 mowo_process.py 处理帧图片
  生产端扫码发货（Vue `/app/admin/production-scan`）✅
    查询模式：扫材料包/订单码/快递单号
    发货模式：扫面单→逐件扫订单码→配齐确认→shipped
    等候区：未配齐跳过，被扫到时弹出确认归属
```

---

## 服务器配置（阿里云ECS，待部署）

**推荐规格：** 2核4G，40G SSD，5Mbps带宽

```
Nginx     — 反向代理 + 静态文件服务
PHP-FPM   — CRMEB运行环境
Node.js   — content-service（PM2管理）
MySQL 8.0 — CRMEB数据库
PostgreSQL 18 — content-service数据库
```

**Nginx配置要点：**
```nginx
server {
  listen 443 ssl;
  server_name mowobox.com;

  location / {
    root /var/www/mowo/frontend/pages;
    try_files $uri $uri/ /index.html;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3001/api/;
    proxy_set_header Authorization $http_authorization;
  }

  location /api/shop/ {
    proxy_pass http://127.0.0.1:8080/;
  }
}
```

---

## 环境变量

### content-service/.env（本地）
```
DATABASE_URL=postgresql://postgres:<本地数据库密码>@localhost:5432/mowo_db
JWT_SECRET=<至少32位的本地随机字符串>
OSS_REGION=oss-cn-shanghai
OSS_BUCKET=mowo-uploads
OSS_ACCESS_KEY_ID=<仅保存在.env中>
OSS_ACCESS_KEY_SECRET=<仅保存在.env中>
PORT=3001
NODE_ENV=development
```

### content-service/.env（生产，待配置）
```
DATABASE_URL=postgresql://user:pass@localhost:5432/mowo_db
JWT_SECRET=<强随机字符串，32位以上>
OSS_REGION=oss-cn-shanghai
OSS_BUCKET=mowo-uploads
OSS_ACCESS_KEY_ID=xxx
OSS_ACCESS_KEY_SECRET=xxx
CRMEB_API_BASE=http://127.0.0.1:8080/api
CRMEB_API_TOKEN=xxx
PORT=3001
NODE_ENV=production
```

---

## 账号注销执行任务

账号注销不在用户点击按钮时直接删除资料。`routes/account.js` 写入 `account_deletion_requests`、将账号标记为 `PENDING_DELETE`，并设置 10 分钟防误操作保护期；`lib/scheduler.js` 默认每 1 分钟寻找保护期已满的申请，再调用 `lib/account-deletion.js` 完成业务复查、私有文件删除和数据库匿名化。失败会记录原因并在 15 分钟后重试；连续失败 3 次或首次失败持续 1 小时会转 `MANUAL_REVIEW` 并停止自动重试。

当前任务仍随 API 进程启动，适合本地和单实例邀请测试。后台 `admin-account-deletions.html` 提供客服只读监控及负责人重试、暂停和恢复；超过 24 小时显示紧急、超过 48 小时显示超出内部目标。正式多实例部署前应迁到独立 Worker 或可靠任务队列，并接入主动告警和处理时长监控；否则 API 全部停机时注销任务也会停止。
