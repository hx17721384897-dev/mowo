# 哞屋 (MOWO) 项目架构文档

本文档概述了哞屋 (MOWO) 项目的整体目录结构和各主要文件/目录的功能。

## 目录树概览

```text
mowo/
├── content-service/    # 后端 Node.js API 服务（Fastify + Prisma）
├── crmeb/              # 电商后台/前端代码预留目录（目前为空/仅占位）
├── docs/               # 项目说明与技术文档
├── frontend/           # 静态纯前端页面（HTML/CSS/JS）
├── .gitignore          # Git 忽略配置
├── CLAUDE.md           # 针对 AI 助手的项目指令与约定
└── README.md           # 项目总体介绍
```

---

## 详细结构说明

### 1. `frontend/` - 静态前端
包含所有面向用户和创作者的 Web 页面。基于原生 HTML/CSS/JS 编写，无打包工具。

- **`js/`**
  - `router.js`：前端页面间的路由跳转映射封装。
- **`pages/`**：存放所有业务页面的 HTML 文件。
  - **核心页面**
    - `index.html`：首页/落地页，展示产品核心价值和引流。
    - `about.html`：关于我们页面。
    - `products.html`：产品介绍页，展示不同款式动画机。
    - `contact.html`：联系我们、合作与反馈页面。
    - `community.html`：社区分享页，展示所有创作者上架的作品和文章（信息流）。
    - `work-detail.html`：作品/文章详情页，展示动画、评论，支持选配机型并加购。
  - **用户交易链路**
    - `auth.html`：登录与注册页，包括弹窗和相关业务逻辑。
    - `cart.html`：购物车页面。
    - `checkout.html`：结算确认页面（地址、订单摘要、支付）。
    - `orders.html`：我的订单列表页。
    - `order-detail.html`：订单详情页。
    - `favorites.html`：我的收藏夹页。
  - **创作与定制链路**
    - `customize-start.html`：定制/创作流程入口页。
    - `customize-editor.html`：在线定制编辑器（上传图片、逐帧排版等）。
    - `customize-confirm.html`：定制确认与生成预览页。
  - **创作者中心**
    - `creator-certify.html`：创作者入驻认证页。
    - `creator-profile.html`：创作者个人资料管理。
    - `creator-works.html`：创作者我的作品管理。
    - `creator-product-edit.html`：作品上架/编辑商品页。
    - `creator-article-stats.html`：文章数据统计页。
    - `creator-product-stats.html`：商品数据统计页。
    - `creator-earnings.html`：创作者收益管理与提现页。
  - **其他**
    - `RENAME_GUIDE.md`：记录了旧文件名到新文件名的映射规范。

### 2. `content-service/` - 后端 API 服务
提供给前端调用的 Node.js 后端接口，基于 Fastify 框架，通过 Prisma 操作数据库。

- **`prisma/`**：数据库与 ORM 配置。
  - `schema.prisma`：Prisma 数据模型定义（User, Article, Product, Order 等表结构）。
  - `migrations/`：数据库迁移脚本历史记录。
- **`src/`**：后端源码目录。
  - `index.js`：应用主入口，组装路由、注册插件并启动服务器。
  - **`plugins/`**：Fastify 插件配置。
    - `jwt.js`：JWT 认证插件，处理 Token 校验。
    - `prisma.js`：Prisma 数据库实例挂载插件。
  - **`lib/`**：工具库。
    - `auth.js`：认证相关的辅助函数（如权限拦截校验）。
  - **`routes/`**：各业务模块的 API 路由处理。
    - `auth.js`：登录、注册、用户信息等。
    - `feed.js`：信息流接口（首页推荐、社区瀑布流等）。
    - `articles.js`：文章（作品动态）的发布、查询、点赞等。
    - `animations.js`：动画资源的上传与管理。
    - `products.js`：商品上架与查询（对应可售卖的动画机）。
    - `users.js`：用户关注、粉丝列表等互动功能。
    - `certify.js`：创作者认证申请与审核。
    - `earnings.js`：创作者收益统计与流水。
- **`test.http`**：API 测试文件，可配合 VSCode 插件快速测试接口。
- **`package.json`**：后端依赖声明与 npm scripts（如 `npm run dev`）。

### 3. `docs/` - 项目文档
系统架构与技术规范相关文档。

- `API.md`：后端接口定义文档。
- `ARCHITECTURE.md`：项目整体架构说明。
- `DATABASE.md`：数据库表结构及关系说明。
- `FRONTEND.md`：前端开发规范、目录说明与联调指南。

### 4. 根目录其他文件
- `README.md`：项目总说明、启动与部署指南。
- `CLAUDE.md`：给 AI 辅助编程工具（如 Claude/Trae）准备的上下文和行为准则。
- `.gitignore`：Git 提交时忽略的文件配置。
