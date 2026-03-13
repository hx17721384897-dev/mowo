# CLAUDE.md — AI 工作守则

> 每次开始新对话前必须先读这个文件。这是哞屋（MOWO / mowobox）项目的核心规范文档。

---

## 项目简介

**哞屋（mowobox）** 是一个动画机电商撮合平台。
- 创作者上传逐帧动画内容
- 平台按需生产实体动画机（走马灯/西洋镜原理）
- 消费者购买收藏或送礼

**Slogan：** 让每帧热爱，都能被触摸。

**品牌信息：**
- 中文品牌名：哞屋 / 哞屋造物
- 英文品牌名：MOWO（产品对外）/ mowobox（商标注册名）
- 网站域名：mowobox.com（规划中）
- API 域名：api.mowo.com（规划中）

---

## 技术栈（不得擅自更改）

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | 纯 HTML5 + CSS3 + 原生 JS (ES6+) | 无框架，无构建工具 |
| 内容后端 | Node.js + Fastify | 端口 3001 |
| ORM | Prisma | 连接 PostgreSQL |
| 数据库1 | PostgreSQL | 内容服务专用 |
| 数据库2 | MySQL | CRMEB 自带 |
| 商城后端 | CRMEB 单商户版（PHP） | 只调 API，不改源码 |
| 文件存储 | 阿里云 OSS | 动画帧图、封面视频 |
| 部署 | 阿里云 ECS + Nginx + PM2 | 单台服务器 |

**绝对禁止：**
- 前端引入 React / Vue / Angular 等框架
- 前端引入 Webpack / Vite 等构建工具
- 修改 `crmeb/` 目录下任何源码
- 擅自新增 npm 依赖（需先确认）

---

## 项目目录结构

```
mowo/
├── CLAUDE.md                    ← 本文件，AI 必读
├── docs/
│   ├── ARCHITECTURE.md          ← 整体架构说明
│   ├── FRONTEND.md              ← 前端页面清单与规范
│   ├── DATABASE.md              ← 数据库表设计
│   ├── API.md                   ← 接口定义文档
│   └── DEPLOY.md                ← 部署步骤（上线时补充）
│
├── frontend/                    ← 纯静态前端
│   ├── pages/                   ← 所有 HTML 页面
│   ├── assets/                  ← 字体、图标、静态图片
│   ├── css/                     ← 公共样式（暂未拆分）
│   ├── js/                      ← 公共脚本（暂未拆分）
│   └── vercel.json              ← 备用 Vercel 配置
│
├── content-service/             ← Node.js + Fastify 后端
│   ├── src/
│   │   ├── app.js
│   │   ├── config.js
│   │   ├── routes/
│   │   ├── plugins/
│   │   └── models/
│   ├── prisma/
│   │   └── schema.prisma
│   ├── package.json
│   ├── .env.example
│   └── Dockerfile
│
└── crmeb/                       ← CRMEB 单商户版（只读，不改源码）
    └── [CRMEB 源码...]
```

---

## 前端开发规范

### 设计变量（所有页面必须遵守）
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

### JS 规范（防止变量提升报错）
- **所有 `const` / `let` 必须声明在 `<script>` 块最顶部**
- 顺序：全局常量 → 运行时状态变量 → `(function init(){})()` → 函数定义
- IIFE 内部不得使用任何在其后才声明的 `const` / `let`
- 每个 script 块开头加 `/* ══ 全局常量区 ══ */` 注释

### 本地存储 key 约定
```
mowo_token          — JWT 登录 token（对象含 name / userId / is_creator）
mowo_cart           — 购物车数组
mowo_pending_order  — 立即购买待结算数据
mowo_customize_frames — 定制流程帧图数组
mowo_customize_meta   — 定制流程元数据
```

### 断点
- 移动端：< 640px
- 平板：640px ~ 1023px
- 桌面：≥ 1024px

---

## 后端开发规范

### API 路径约定
```
/api/auth/*         — 注册、登录、刷新 token
/api/works/*        — 作品（文章/动画帧）
/api/community/*    — 社区帖子、点赞、评论
/api/creators/*     — 创作者公开信息、关注
/api/products/*     — 创作者商品上架/编辑
/api/certify/*      — 创作者认证申请
/api/earnings/*     — 收益查询、提现
/api/upload/*       — 文件上传（OSS 预签名）
```

### 认证方式
- JWT，token 有效期 7 天
- Header：`Authorization: Bearer <token>`
- 前端存储 key：`mowo_token`

### 机型规格常量（前后端共用逻辑）
```javascript
const MACHINE_SPECS = {
  cylinder:     { label: '经典圆筒款', frames: [12, 16, 24] },
  lantern:      { label: '手提灯笼款', frames: [12, 16] },
  hexagon:      { label: '六棱柱款',   frames: [6, 12] },
  'flat-round': { label: '扁圆盒款',   frames: [12, 24] },
  'mini-pendant':{ label: '迷你挂件款', frames: [12] },
}
```

---

## 当前开发进度

- [x] 前端页面全部完成（见 docs/FRONTEND.md）
- [ ] content-service 数据库表设计（进行中）
- [ ] content-service 后端 API 开发
- [ ] 前端对接真实 API
- [ ] CRMEB 下载配置
- [ ] 支付宝/微信支付接入
- [ ] 服务器部署

---

## 重要决策记录

| 决策 | 结论 | 原因 |
|------|------|------|
| 账号体系 | 统一账号，`is_creator` 字段区分身份 | 简化注册流程 |
| 前端 CSS/JS | 暂不拆分公共文件 | 后端跑通后再做优化 |
| 商城系统 | CRMEB 单商户版，只调 API | 不改源码保持可升级 |
| 服务器 | 单台阿里云 ECS，Nginx 反向代理 | 初期够用，大了再拆 |
| ORM | Prisma | 类型安全，迁移方便 |
| 定价模型 | 平台底价 + 创作者加价，加价扣15%平台费 | 撮合平台标准模型 |
| 套装销售 | 各单品独立 SKU + 满减优惠券 | 避免 SKU 组合爆炸 |
| 盲盒销售 | 单个随机 + 全套 两个 SKU | 购买行为差异大 |
