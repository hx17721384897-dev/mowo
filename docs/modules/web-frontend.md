# Web 前端页面与公共脚本

> 初始调查基准：2026-08-12。2026-08-13 已完成账号/文件安全阶段的页面整改：协议链接、登录设备按钮、联名展示命名及首发功能入口已更新；以下未标注“已整改”的内容仍是调查事实。
> R1-B 更新（2026-09-14）：退役页面、消费者和旧功能开关脚本已删除，并已建立独立 `frontend-vue/` V0 脚手架。V1b 更新（2026-09-15）：Vue 已接管联名货架与详情，旧 `showcase*.html` 和专用 JS 已删除；下文 2026-08 页面清单仅用于历史追溯，不代表现行入口。
> V2 更新（2026-09-21）：Vue 已接管账户设置、共享地址管理、动画、定制列表及用户定制全流程；对应旧用户页已物理删除。旧共享编辑器只保留 V4/V5 后台模式。本文“技术形态”和旧页面调查段落属于历史快照，现行入口以“定制、购物车与用户中心”表为准。
> V4-C 更新（2026-09-29）：Vue `/app/admin/collab-works` 与 `/app/admin/collab-product/:id` 已接管联名作品和商品编辑；对应旧 HTML 已物理删除，旧地址只保留临时 302 交接。下表中的旧联名页面行仅作 2026-08 历史快照。
> V4-E2 更新（2026-09-29）：Vue `/app/admin/orders` 已接管正式生产订单八阶段工作台；旧订单 HTML 及其已无消费者的浏览器 ZIP/XLSX 历史库已删除，旧地址仅保留临时 302。

## 2026-08-13 首发显示状态

- 新增 `js/feature-flags.js`，从 `/api/config/features` 读取服务端开关；关闭时隐藏社区互动、模拟认证、自助联名、创作者收益/牛量/引流入口，直接访问旧页会回到可用页面。
- `showcase.html` 现名“联名作品”，继续开放审核后作品展示和购物；列表及两套详情在社区关闭时不展示点赞/关注。
- 注册协议链接已指向可阅读的测试版用户协议和隐私政策；首页、FAQ 页脚同步修复。
- 订单空状态和订单详情已不再链接不存在的 `community.html`。
- 创作者收益、牛量、自助联名和模拟认证页面代码仍保留，当前可见性不代表删除未来设计。

## 调查范围与完成度

初次调查曾核对当时的 53 个 HTML 页面。2026-09-08 目录已有 58 个 HTML 页面，且联名详情、生产扫码和后台帧图页面经历过收口；旧数量和旧入口清单不再有效。本模块将在前端专项按“唯一正式入口、仍存旧页、API 消费者和断链”重新逐页核对。

本轮采用静态源码、引用关系、API 消费者和 JavaScript 语法检查。当前仓库没有 Playwright/jsdom/parse5，也没有前端构建与测试脚本，因此未做浏览器渲染、交互回放和全链路网络测试；这些归入第 8 批运行质量调查。

## 技术形态

- 纯 HTML + 页面内联 CSS/JavaScript，没有 npm 前端工程、打包器、类型系统或组件框架。
- 公共导航使用 `nav.js` + `nav.css`；登录弹窗、Token 刷新和用户下拉使用 `auth.js`。
- 管理后台部分复用 `admin-sidebar.js`，但每页仍各自实现 API client、鉴权跳转、表格和弹窗。
- 地址解析使用 ES module `address-utils.js` 和本地 `assets/regions.json`。
- 该条为 2026-08 历史形态；现行设置业务位于 Vue `SettingsView` 与共享 `AddressBook`，旧 `settings.js` 已删除。
- 旧管理订单页曾携带本地 `jszip.min.js` 和 `xlsx.full.min.js`，V4-E2 切换后无消费者并已删除；FAQ 从 CDN 加载 Fuse.js，设置页从 CDN 加载 Cropper.js；大量页面加载 Google Fonts。
- 页面体量较大：`customize-editor.html` 约 2196 行，`admin-inventory.html` 约 2049 行，`creator-collab.html` 约 1700 行；多个页面超过 1000 行并包含完整样式和业务逻辑。

## 公共文件

| 文件 | 职责 | 当前使用与问题 |
|---|---|---|
| `js/auth.js` | v1 短信/密码登录、Access Token 刷新、全局 fetch 401 重试、用户下拉 | Access Token 与用户缓存放 localStorage；用户资料仍从旧 `/api/auth/me` 拉取；头像 URL 拼入 innerHTML |
| `js/nav.js` | 注入桌面/移动导航 | 当前展示“联名作品”；依据 localStorage 同步用户状态 |
| `js/admin-sidebar.js` | 注入后台分组侧栏 | 按员工岗位和服务端首发开关裁剪；实际权限仍以后端为准 |
| `js/feature-flags.js` | 读取首发功能状态并隐藏/拦截旧入口 | 服务端开关是最终边界；读取失败按全部未来功能关闭处理 |
| `js/settings.js`（已删除） | 旧设置页业务 | V2 真实接口回归通过后随旧页物理删除 |
| `js/router.js` | 页面跳转和本地角色检查 | 2026-08-13 已改为 `window.Router` 供普通 script 使用；多数历史目标页仍已不存在或移入 `_legacy` |
| `js/address-utils.js` | 行政区加载、地址解析、三级联动 | ES module；结算、独立地址页和设置页分别接入 |
| `css/nav.css` | 公共导航样式 | 16 个现行公共/用户页面引用 |
| `css/design-system.css` | 设计变量和通用样式 | 当前 HTML 未发现引用，属于未接入资产 |

## 环境与会话事实

几乎所有 API 页面重复定义如下地址逻辑：只有 hostname 严格等于 `127.0.0.1` 时请求 `127.0.0.1:3001`，其他所有域名都请求 `localhost:3001`。`orders.html`、`order-detail.html`、`admin-contact.html` 更是直接固定 localhost。当前没有注入生产 API Origin、同源 `/api` 代理或环境配置文件，正式部署会请求访问者本机。

`auth.js` 的会话策略是：

1. Access Token 保存在 `localStorage.mowo_token`。
2. Refresh Token 通过 HttpOnly Cookie 携带到 `/api/v1/auth/refresh`。
3. 全局包装 `window.fetch`，API 返回 401 时并发合并刷新并重试一次。
4. 用户信息缓存在 `localStorage.mowo_user`，读取用户仍调用旧 `/api/auth/me`。
5. 登出调用 v1 logout，然后清除本地缓存。

`creator-animations.html`、`creator-collab.html`、`creator-notifications.html` 没有加载 `auth.js`，所以没有统一静默刷新。扫码工作台已于 2026-09-04 接入 `auth.js` 和统一员工身份检查，登录返回地址同时保留当前 `#` 工序。前三个创作者页面仍需后续治理；页面缓存的 role/certifyStatus 只能作为界面提示，不能替代后端实时鉴权。

## 现行页面清单

状态定义：`静态` 表示主要内容写死；`已接 API` 表示有真实请求，不代表业务后端已经企业级闭环；`部分可用` 表示入口、契约或关键流程有明确缺口；`阻断` 表示按当前组合直接访问会发生核心初始化/跳转故障。

### 公共展示与联名

现行联名入口为 Vue `/app/showcase` 与 `/app/showcase/:workId`；公开 DTO、媒体降级、登录恢复和测试证据见 `V1B_COLLAB_STOREFRONT_MIGRATION.md`。下表中的 HTML 条目是初始调查快照。

| 页面 | 当前职责 | API / 数据 | 状态与说明 |
|---|---|---|---|
| `index.html` | 品牌首页 | 本地图片 | 静态；页脚配送、退换、隐私等都指向 contact 或空链接 |
| `about.html` | 品牌与团队 | 无 | 静态；多个 CTA 为 `#` |
| `products.html` | 产品系列 | 无 | 静态硬编码，产品主体使用 CSS mock 图，不是后台款式数据 |
| `faq.html` | FAQ 搜索/分类 | 本地 FAQ + CDN Fuse.js | 静态；注释规划 `/api/faq`，后端无该路由 |
| `contact.html` | 六类联络、附件上传 | `/api/upload/presign`、`/api/contact` | 已接 API；前端要求登录，后端公开；附件风险见内容模块 |
| `showcase.html` | 唯一联名商品列表 | `/api/collab/works` | 已接正式上架数据；保留瀑布流和商品进入口，正式页不包含社区互动代码 |
| `showcase-detail.html` | 唯一联名商品详情、素材轮播、动画播放、选 SKU 与加购 | collab/cart | 2026-09-07 完成；仅展示后台正式资料和真实可售 SKU，未登录操作在登录后重新校验并继续 |

### 定制、购物车与用户中心

| 页面 | 当前职责 | API / 状态 | 主要缺口 |
|---|---|---|---|
| Vue `/app/customize` | 选择款式/SKU、配额检查、动画复用 | 已接 machine-models/custom-products/animation-assets | V2-D1 已关闭；旧 HTML 已物理删除 |
| Vue `/app/customize/editor` | 用户新建、草稿重编、动画改版和人工结果只读确认 | 已接 custom-products/customization-requests/animation-assets | D2-C/D2-D 已接管全部用户编辑模式；共享安全上传、能力矩阵与幂等草稿 |
| `customize-editor.html` | 后台筛帧 | 已接后台 customization API | 仅保留 `adminRequestId`；待后台筛帧迁移后删除 |
| Vue `/app/customize/confirm` | 选配、确认定制、幂等加购并进入结算 | 已接确认上下文/customization-requests/animation-assets/cart | 已接管三类正式入口；旧 HTML 已删除，旧 URL 临时 302 |
| `cart.html` | 服务端购物车 | 已接 cart | 只加载登录购物车；未登录购买由详情页保留短期操作意图，登录后重新校验并写入服务端 |
| `checkout.html` | 地址、创建预订单、轮询支付 | 已接 cart/addresses/payment | 真实支付发起未闭环；localhost 显示 Mock 支付 |
| `orders.html` | 我的订单与确认收货 | 已接 orders | 空状态已改为联名作品入口 |
| `order-detail.html` | 订单详情、取消、收货、售后、凭证上传 | 已接 orders/upload | 固定 localhost；社区导航已改为联名作品 |
| Vue `/app/account/animations` | 定制动画列表、改名、删除、继续编辑 | 已接 animation-assets + custom-products | 使用共享账户壳；旧页已删除 |
| Vue `/app/account/settings#addresses` | 地址新增、编辑、删除、默认地址 | 已接 addresses | 与 V3 结算选择模式复用同一 `AddressBook` 领域组件；旧独立地址页已删除 |
| Vue `/app/account/settings` | 资料、头像、安全、设备退出、注销、地址 | 已接 v1 account/upload/addresses | 已通过真实隔离库回归；旧 HTML/JS 已删除 |

### 创作者页面

| 页面 | 当前职责 | 状态 | 主要说明 |
|---|---|---|---|
| `creator-animations.html` | 创作者素材/定制动画管理 | 部分可用 | 真 API；不加载 auth.js，未登录跳不存在的 auth.html |
| `creator-certify.html` | 四步创作者认证申请 | 模拟/断开 | 实名用 2 秒定时器模拟腾讯云，作品仅 dataURL，本轮未见提交 `/api/certify` |
| `creator-collab.html` | 联名申请、修改、加价和作品管理 | 部分可用 | 真 API；不加载 auth.js，依赖本地认证缓存 |
| `creator-dashboard.html` | 收益/牛量/近期订单总览 | 已接 API | 下游财务和牛量闭环问题见联名模块 |
| `creator-earnings.html` | 收益、提现、储备金 | 已接 API | 真实外部打款尚未闭环 |
| `creator-links.html` | 推广链接和社交视频 | 已接 API | 外链 URL 校验和归因闭环不足 |
| `creator-notifications.html` | 通知列表和已读 | 部分可用 | 真 API；不加载 auth.js，未登录断链 |
| `creator-profile.html` | 公开创作者主页 | 已接 users/products/articles | 卡片跳不存在的 `work-detail.html`；外链/头像存在输出安全风险 |

### 管理与生产页面

| 页面 | 当前职责 | 权限/状态 | 说明 |
|---|---|---|---|
| Vue `/app/admin/orders` | 正式订单八阶段、地址/生产资料导出、面单与返工 | `OWNER`/`PRODUCTION`，已接正式 API | V4-E2 正式接管；旧 HTML 已删除，重印具备服务端幂等键 |
| Vue `/app/admin/import` | 外部平台订单导入保留入口 | `OWNER`/`PRODUCTION`；写入由服务端关闭 | V4-E3 不假设表格模板，旧 HTML 与旧 API 已删除 |
| `admin-models.html` | 款式/SKU/价格/图片/排序 | role >= 2，已接 API | 页面内维护选项写 localStorage，未形成后端主数据 |
| `admin-inventory.html` | SKU、材料、帧包、渠道配额 | role >= 2，已接 API | 单页超过 2000 行；多个库存域集中在一页 |
| `admin-collab-works.html` | 联名作品运营 | 已由 Vue 接管并物理删除 | 旧地址临时 302 到 `/app/admin/collab-works` |
| `admin-collab.html` | 联名审核 | 已退役并物理删除 | 首发合作确认走线下，不提供在线审核 |
| `admin-collab-activities.html` | 活动配置 | role >= 2，已接 API | 真 API |
| `admin-collab-policy.html` | 违约政策 | 已退役并物理删除 | 没有真实结算消费者，首发不保留配置能力 |
| `admin-settlement.html` | 分红结算 | role >= 2，已接 API | 当前“打款”是内部余额动作 |
| `admin-bull.html` | 牛量与参数 | role >= 2，已接 API | 数据来源断层见 D-043 |
| `admin-links.html` | 外部视频审核 | role >= 2，已接 API | URL 打开新窗口，部分位置缺少 noopener/协议限制 |
| `admin-contract.html` | 商务合同/打款记录 | 已退役并物理删除 | 合同与付款在线下保管，不进入首发平台 |
| `admin-revenue-config.html` | 分红配置 | 读 role >= 2、写 role >= 3 | 未加载统一 admin-sidebar，页面自有导航 |
| `admin-contact.html` | 联络留言和附件 | role >= 2，已接 API | 固定 localhost；外链/附件授权风险见 D-055 |
| `admin-users.html` | 用户角色/封禁 | role >= 2，改角色 role >= 3 | highlight 搜索契约差异见 D-056 |
| `admin-account-deletions.html` | 注销任务状态、异常重试和暂停/恢复 | 运营客服只读；负责人可操作 | 手机号脱敏；无人工审批或强制删除 |
| `admin-logs.html` | 审计日志 | role >= 3 | 前后端权限一致 |
| `production-scan.html` | 帧包、领料、配对与装箱统一工作台 | staffRole 员工，已接正式生产 API | 唯一页面；旧岗位文件和旧查询参数仅兼容跳转 |
| `production-inventory.html` | 库存、入库、调整、批次进度 | 页面 role >= 1 | API 权限/字段/路由不匹配，见 D-069；失败跳转也错层级 |

## 旧版页面

| 页面 | 原职责 | 当前状态 |
|---|---|---|
| `_legacy/admin-production.html` | 老生产看板 | 仍含真 API；移动后 `../js/*` 实际解析到 `pages/js/*`，脚本失效 |
| `_legacy/community.html` | 老社区 feed | 旧 API 消费者；公共导航和脚本相对路径均错 |
| `_legacy/work-detail.html` | 旧文章/商品详情 | 旧 API 消费者；相对路径失效 |
| `_legacy/favorites.html` | 收藏 | 主要本地数据；相对导航失效 |
| `_legacy/creator-works.html` | 旧创作者作品 | 旧入口；含不存在的 article-editor 等跳转 |
| `_legacy/creator-article-stats.html` | 旧文章统计 | 页面保留；脚本和现行页跳转失效 |
| `_legacy/creator-product-edit.html` | 旧商品编辑 | 页面保留；脚本和现行页跳转失效 |
| `_legacy/creator-product-stats.html` | 旧商品统计 | 页面保留；脚本和现行页跳转失效 |
| `_legacy/creator-earnings1.html` | 旧收益页 | 页面保留；脚本和现行页跳转失效 |

移动到 `_legacy` 只改变了目录，没有同步修正依赖路径，也没有统一的重定向/410/功能开关。它们适合作为历史参考，不能作为可运行兼容页。

## 主要页面关系

```text
index / products / showcase
├─ showcase-detail
│  └─ cart -> checkout -> orders -> order-detail
└─ Vue /app/customize -> Vue /app/customize/editor -> Vue /app/customize/confirm
   └─ cart -> checkout

auth.js user menu
├─ cart / orders
└─ Vue /app/account/settings /app/account/animations /app/account/customizations
├─ creator-dashboard -> earnings / collab / links / notifications / animations
└─ admin-orders -> 统一 admin-sidebar 中的后台页面
```

页面跳转和中间状态没有统一 Router/Store：普通链接、`location.href`、localStorage、sessionStorage 和 URL 参数混用。刷新、跨标签、过期缓存或从深链接直接进入时，行为不一致。

## 文档与代码主要差异

- `docs/FRONTEND.md` 写“唯一公共 JS 是 auth.js、所有页面都引入”；实际还有 nav、settings、router、address、admin-sidebar 等公共文件，4 个真 API 页面未引入 auth.js。
- 原文档称 showcase 只展示、无互动无购买；当前决定是联名展示与购物保留，社区互动由服务端开关关闭。
- 文档把 showcase 标为待开发，代码已有两个详情实现并接真实 API。
- `CLAUDE.md` 将 creator-certify 同时描述为认证入口和废弃旧页；当前设置页仍链接它，但它是模拟流程。
- 文档将多个页面标为完成；当前仍存在正式 API 地址缺失、设置页脚本组合错误、断链和本地缓存身份判断。
- `FRONTEND.md` 记录 13 个后台页，当前有 17 个 `admin-*.html`，并另有 2 个生产页面。

完整编号见 `docs/DOC_CODE_DIFFERENCES.md`。

## 安全、性能与维护风险

| 优先级 | 风险 | 影响 | 建议方向 | 复杂度 |
|---|---|---|---|---|
| P0 | API Origin 固定 localhost | 正式页面无法连接服务端，且可能误访访问者本机服务 | 同源 `/api` 或受控运行时配置；开发代理与生产配置分离 | 低中 |
| P0 | 用户可控 URL 拼入 innerHTML 属性 | 头像/社交 URL 可形成持久化 XSS，进一步读取 localStorage Token | 后端限定 HTTPS/OSS 域名；前端用 DOM 属性赋值；部署 CSP | 中高 |
| P0 | 设置页把 ESM router 当普通脚本 | 页面初始化报错，账户安全/注销/隐私等核心功能不可用 | 统一 ES module 或删除无价值 Router 依赖，并做浏览器冒烟测试 | 低 |
| P1 | Access Token 在 localStorage 且页面大量 innerHTML | 任一 XSS 可直接窃取会话 | 优先消除 XSS；评估同站 HttpOnly 会话/BFF；缩短 Token 与权限实时校验 | 高 |
| P1 | 4 个受保护页面没有公共刷新逻辑 | Token 过期后突然失败，错误跳到不存在页面 | 统一 API client、会话门卫和返回路径 | 中 |
| P1 | 注册协议、隐私、退换等正式文本没有独立页面 | 无法形成清晰同意证据和消费者告知 | 建立版本化法律文档、同意版本/时间记录和可访问入口 | 中 |
| P1 | CDN 脚本无 SRI，页面无 CSP | 供应链篡改或 XSS 的影响面扩大 | 自托管或固定版本+SRI，部署 CSP/安全响应头 | 中 |
| P2 | 页面巨型内联脚本和重复 API client | 修复需多页同步，契约漂移频繁 | 先抽配置/API/会话/输出安全，不必立刻重写框架 | 中高 |
| 已解决 | 两套联名详情 | 2026-09-07 已删除旧页并统一到 `showcase-detail.html` | 用静态检查禁止旧引用回流 | 低 |
| 已解决 | guest cart 只写不读 | 已删除游客购物车与合并接口 | 未登录时只保留短期操作意图，登录后服务端重新校验 | 低 |
| P2 | 旧页移动后路径失效、现行页仍链接旧文件名 | 深链接和空状态出现 404 | 生成路由/链接清单，CI 检查静态引用，旧页显式归档 | 低中 |
| P2 | 大量 Google Fonts 和大图直接加载 | 中国网络可用性、首屏性能和隐私外联不稳定 | 字体自托管/系统字体降级，图片响应式压缩和缓存 | 中 |
| P2 | 无前端测试、构建、lint、类型检查 | 页面组合错误只能人工发现 | 最低先建静态链接检查、API 契约测试和 Playwright 核心流程 | 中高 |

## 待确认事项

产品决策集中在 `docs/OPEN_QUESTIONS.md`。已确认：首发关闭社区与互动；未登录可浏览，正式提交/购买时登录；不支持游客购物车；联名详情已统一为 `showcase-detail.html`；Web 不直接收款，订单转微信小程序。仍待确认的宏观项是法律文本责任和正式部署域名；字段、页面细节留到对应功能开发时讨论。

## 相关文档

- `docs/FRONTEND.md`：历史页面规划与功能说明
- `docs/modules/foundation-auth-security.md`：会话、上传和账户安全
- `docs/modules/commerce-orders-inventory.md`：定制、购物车、订单和支付
- `docs/modules/collab-creator-revenue.md`：联名和创作者功能
- `docs/modules/admin-production.md`：生产与后台风险
- `docs/DOC_CODE_DIFFERENCES.md`、`docs/OPEN_QUESTIONS.md`
