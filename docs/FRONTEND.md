# FRONTEND.md — 前端页面清单与规范

## 重要说明

- 所有前端页面已完成，**未经确认不得修改**
- CSS / JS 全部内联在各 HTML 文件中，暂不拆分
- 所有演示数据（localStorage、硬编码数组）待后端完成后统一替换为 API 调用

---

## 页面清单

### 主站页面

| 文件名 | 页面 | 说明 |
|--------|------|------|
| `index.html` | 主页 | 原名 mowo-homepage.html |
| `about.html` | 关于我们 | 原名 mowo-about.html |
| `products.html` | 产品介绍 | 原名 mowo-product.html，含五款机型详细介绍 |
| `community.html` | 社区分享 | 原名 mowo-community.html，含实时搜索过滤 |
| `contact.html` | 联络我们 | 原名 mowo-contact.html |

### 内容详情页

| 文件名 | 页面 | URL 参数 |
|--------|------|---------|
| `work-detail.html` | 作品/商品详情 | `?type=article` 文章模式，`?type=product&price=299&machine=cylinder` 商品模式 |
| `creator-profile.html` | 创作者公开主页 | `?id=1` 创作者 ID |

### 定制购买流程

| 文件名 | 页面 | 说明 |
|--------|------|------|
| `customize-start.html` | 选型号 | 五款机型选择，选完跳转编辑器 |
| `customize-editor.html` | 上传与筛帧 | 上传动画帧，URL 参数 `?type=cylinder` |
| `customize-confirm.html` | 选款式规格 | 选颜色材质，多款式加购逻辑 |
| `checkout.html` | 结算页 | 演示券码：MOWO20 / MOWO50 / CREATOR10 |

### 用户中心

| 文件名 | 页面 | 说明 |
|--------|------|------|
| `auth.html` | 登录 / 注册 | 含右上角下拉菜单模块 |
| `cart.html` | 购物车 | |
| `favorites.html` | 我的收藏 | |
| `orders.html` | 我的订单 | |
| `order-detail.html` | 订单详情 / 物流 | 含退货入口 |

### 创作者后台

> 创作者后台无页脚，有固定黑色左侧边栏导航

| 文件名 | 页面 | 说明 |
|--------|------|------|
| `creator-works.html` | 我的作品 | Tab 切换文章/动画机，网格展示 |
| `creator-article-stats.html` | 文章数据 | Canvas 折线图，时间范围切换 |
| `creator-product-stats.html` | 商品数据 | 收益折线图 + 销量饼图 |
| `creator-product-edit.html` | 商品编辑 | 四种入口模式，三个视图状态，SKU 配置 |
| `creator-earnings.html` | 收益与提现 | 余额展示，提现操作，收益明细 |
| `creator-certify.html` | 创作者认证 | 四步流程：创作者信息→实名认证→版权声明→协议提交 |

---

## 页面跳转关系

```
index.html
  ├── community.html
  │     └── work-detail.html?type=article   (文章详情)
  │           └── creator-profile.html?id=x
  │                 └── work-detail.html?type=product  (商品详情)
  │                       └── checkout.html
  │
  ├── customize-start.html
  │     └── customize-editor.html?type=cylinder
  │           └── customize-confirm.html
  │                 └── checkout.html
  │
  └── auth.html (右上角)
        ├── cart.html → checkout.html
        ├── favorites.html
        ├── orders.html → order-detail.html
        └── creator-works.html (创作者后台入口)
              ├── creator-article-stats.html
              ├── creator-product-stats.html
              │     └── creator-product-edit.html
              ├── creator-earnings.html
              └── creator-certify.html
```

---

## creator-product-edit.html 四种入口模式

| 入口 | URL 参数 | 行为 |
|------|---------|------|
| 从「我的作品」点「上架」 | `?animId=1` | 直接进编辑视图，自动弹出选配弹窗 |
| 从「商品数据」点「编辑」 | `?id=101` | 进编辑视图，预填已有数据 |
| 组合上架 | `?mode=bundle` | 进选品视图（多选 ≥2 件） |
| 盲盒上架 | `?mode=blindbox` | 进选品视图（多选 ≥6 件） |
| 直接点导航 | 无参数 | 进商品列表视图 |

---

## 本地存储约定

```javascript
// 登录 token
localStorage.getItem('mowo_token')
// 结构：{ userId, name, is_creator, exp }

// 购物车
localStorage.getItem('mowo_cart')
// 结构：[{ id, name, spec, colorHex, price, qty }]

// 立即购买数据（跨页传递）
localStorage.getItem('mowo_pending_order')
// 结构：{ items: [...], from: 'product-detail' | 'customize' }

// 定制流程（customize-editor → customize-confirm）
localStorage.getItem('mowo_customize_frames')  // 帧图 URL 数组
localStorage.getItem('mowo_customize_meta')
// 结构：{ type, frameCount, selectedVariant, basePrice, validTargets, cart, cartTotal }
// 注意：定制流程结束后必须清理这两个 key
```

---

## 机型规格常量

前端各页面内联了以下常量，后端需保持一致：

```javascript
const MACHINE_SPECS = {
  cylinder: {
    label: '经典圆筒款',
    frames: [12, 16, 24],
    materials: ['acrylic', 'wood', 'alum'],
    colors: {
      acrylic: ['transparent', 'frost', 'smoke', 'rose'],
      wood:    ['natural', 'walnut', 'white'],
      alum:    ['black', 'silver', 'gold'],
    }
  },
  lantern: {
    label: '手提灯笼款',
    frames: [12, 16],
    materials: ['wood', 'acrylic'],
    colors: { wood: ['natural', 'walnut'], acrylic: ['transparent', 'rose'] }
  },
  hexagon: {
    label: '六棱柱款',
    frames: [6, 12],
    materials: ['alum', 'acrylic'],
    colors: { alum: ['black', 'silver'], acrylic: ['transparent', 'smoke'] }
  },
  'flat-round': {
    label: '扁圆盒款',
    frames: [12, 24],
    materials: ['acrylic', 'wood'],
    colors: { acrylic: ['transparent', 'frost'], wood: ['natural', 'walnut'] }
  },
  'mini-pendant': {
    label: '迷你挂件款',
    frames: [12],
    materials: ['acrylic'],
    colors: { acrylic: ['transparent', 'rose', 'smoke'] }
  },
}
```

---

## 待对接 API 清单（前端当前使用演示数据的位置）

对接后端时需逐一替换以下演示逻辑：

| 页面 | 当前演示数据 | 需对接的 API |
|------|------------|-------------|
| `auth.html` | 本地校验 | `POST /api/auth/login` `POST /api/auth/register` |
| `community.html` | 硬编码帖子数组 | `GET /api/community/posts` |
| `work-detail.html` | 硬编码作品数据 | `GET /api/works/:id` |
| `creator-profile.html` | CREATORS 常量 | `GET /api/creators/:id` |
| `cart.html` | localStorage | `GET/POST /api/shop/cart` (CRMEB) |
| `orders.html` | 硬编码订单 | `GET /api/shop/orders` (CRMEB) |
| `creator-works.html` | 硬编码作品 | `GET /api/works/mine` |
| `creator-product-edit.html` | 本地状态 | `POST /api/products` `PUT /api/products/:id` |
| `creator-earnings.html` | 硬编码收益 | `GET /api/earnings/summary` |
| `creator-certify.html` | 模拟核验 | `POST /api/certify/apply` |
