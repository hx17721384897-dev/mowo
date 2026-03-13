# ARCHITECTURE.md — 整体架构说明

## 系统架构图

```
用户浏览器
     │
     ▼
  Nginx :80/:443
  (阿里云 ECS)
     │
     ├── /                  → frontend/pages/        (静态 HTML)
     ├── /assets/*          → frontend/assets/        (静态资源)
     ├── /api/content/*     → content-service :3001   (Node.js)
     └── /api/shop/*        → CRMEB :8080             (PHP)
          │
          ├── MySQL          (CRMEB 商城数据)
          └── PostgreSQL     (内容服务数据)

外部服务：
  ├── 阿里云 OSS             (动画帧图、封面视频、用户头像)
  ├── 腾讯云实名认证 API      (创作者身份核验)
  ├── 微信支付               (通过 CRMEB 接入)
  └── 支付宝                 (通过 CRMEB 接入)
```

---

## 三端职责划分

### frontend/（纯静态）
- 所有页面的 HTML / CSS / JS
- 不含任何服务端逻辑
- 通过 fetch 调用后端 API
- 静态文件由 Nginx 直接服务

### content-service/（Node.js + Fastify）
负责平台自有业务逻辑：
- 用户注册、登录、JWT 签发
- 创作者认证申请与审核
- 作品上传、社区内容管理
- 创作者商品上架配置
- 收益记录、提现申请
- 文件上传（OSS 预签名 URL）

### crmeb/（PHP，只调用不修改）
负责标准电商流程：
- 商品 SKU 管理
- 购物车、下单
- 微信支付 / 支付宝
- 订单状态管理
- 物流信息

---

## 数据流说明

### 用户购买流程
```
前端选商品 → work-detail.html
  → 选规格弹窗（前端本地）
  → 立即购买 → checkout.html
  → 调用 CRMEB 下单 API /api/shop/order/create
  → 调用 CRMEB 支付 API /api/shop/pay
  → 支付回调 → CRMEB 更新订单状态
  → content-service 监听回调 → 记录创作者收益
```

### 创作者上架流程
```
creator-product-edit.html
  → 调用 content-service /api/products/create
  → content-service 同步调用 CRMEB 商品 API 创建 SKU
  → 前端展示上架成功
```

### 定制购买流程
```
customize-start.html（选型号）
  → customize-editor.html（上传帧图 → OSS）
  → customize-confirm.html（选款式规格）
  → checkout.html
  → CRMEB 下单（定制商品特殊 SKU）
```

---

## 服务器配置（阿里云 ECS）

**推荐规格：** 2核 4G 内存，40G SSD，带宽 5Mbps

**运行进程：**
```
Nginx          — 反向代理 + 静态文件服务
PHP-FPM        — CRMEB 运行环境
Node.js (PM2)  — content-service
MySQL 8.0      — CRMEB 数据库
PostgreSQL 15  — content-service 数据库
```

**Nginx 配置要点：**
```nginx
server {
  listen 443 ssl;
  server_name mowobox.com;

  # 静态前端
  location / {
    root /var/www/mowo/frontend/pages;
    try_files $uri $uri/ /index.html;
  }

  # 内容服务 API
  location /api/content/ {
    proxy_pass http://127.0.0.1:3001/;
  }

  # CRMEB 商城 API
  location /api/shop/ {
    proxy_pass http://127.0.0.1:8080/;
  }
}
```

---

## 环境变量清单

### content-service/.env
```
DATABASE_URL=postgresql://user:pass@localhost:5432/mowo_content
JWT_SECRET=your_jwt_secret_here
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=mowo-uploads
OSS_ACCESS_KEY_ID=xxx
OSS_ACCESS_KEY_SECRET=xxx
CRMEB_API_BASE=http://127.0.0.1:8080/api
CRMEB_API_TOKEN=xxx
TENCENT_VERIFY_APP_ID=xxx
TENCENT_VERIFY_SECRET_KEY=xxx
PORT=3001
NODE_ENV=production
```
