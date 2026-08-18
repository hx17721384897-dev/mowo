# 小程序工程代码事实

> 调查范围：主仓库同级目录 `../xiaochengxu/`。调查基准：2026-08-12。
> 该目录不属于 `mowo/.git`，本轮只读代码并在主仓库补充文档，没有修改小程序业务文件。

## 调查范围与完成度

- 已读取 `RULES.md`、`package.json`、`manifest.json`、`pages.json`、应用入口、请求封装、3 个 Pinia Store、公共类型、TabBar 和全部 14 个页面。
- 已把小程序使用的 API 与 `content-service` 当前路由、返回结构和认证实现逐项对照。
- 已核对静态资源引用和实际文件；未运行会改写 `dist/` 的构建。
- `npm run type-check` 在 120 秒内没有结束，也没有输出诊断，当前不能记为通过。
- 尚未取得微信 AppID、合法域名、隐私配置或真机环境，因此发布、登录续期、上传和支付仍需后续实机验收。

## 模块职责与当前成熟度

小程序定位为用户侧购买入口，规划能力包括联名作品浏览、短信登录、定制上传、购物车、结算、订单、地址和通知。当前更准确的状态是“可继续开发的 UI 骨架”，不是可发布版本。

| 状态 | 页面 | 代码事实 |
|---|---|---|
| 已接 API，但契约不通 | 首页、短信登录 | 首页分页结构不匹配；新用户协议字段不匹配 |
| 部分 UI | 我的 | 展示登录态并调用退出；资料编辑、设置、帮助和反馈未实现 |
| 静态入口 | 定制首页 | 只有流程说明和跳转，上传/预览仍是占位 |
| 静态空状态 | 购物车 | 没有读取 Cart Store，也没有商品列表或结算动作 |
| 统一占位页 | 作品详情、结算、订单列表、订单详情、地址列表、地址编辑、通知、上传、预览 | 页面只显示“开发中”，没有业务状态和 API |

14 个注册页面中，7 个是同类占位页；购物车和定制首页虽有独立 UI，也没有形成业务闭环。

### 已确认的首发通知边界

- 普通用户需要接收定制审核结果、付款结果、订单状态、发货、售后和账号安全通知。
- 小程序内应提供可查询的消息记录；微信订阅消息必须由用户主动授权，不能把一次授权扩大为营销同意。
- 短信只用于验证码和重要安全/订单异常，不发送营销短信；社区互动通知不属于首发范围。
- 当前只面向创作者且路径不匹配的通知接口不能直接充当普通用户通知中心，需要按事件和受众重新建立契约。

## 技术实现

| 层次 | 当前实现 |
|---|---|
| 框架 | uni-app `3.0.0-4080420251103001`、Vue 3.4、TypeScript 4.9、Vite 5 |
| 状态 | Pinia 3；`user`、`cart`、`app` 三个 Store |
| UI 依赖 | 声明 `uview-plus`，当前入口未注册，已查页面未形成组件体系 |
| 样式 | SCSS 变量和全局样式；页面使用自定义导航与自定义 TabBar |
| 网络 | `src/api/request.ts` 封装 `uni.request`、Bearer Token 和 401 刷新队列 |
| 发布目标 | `package.json` 保留 H5、微信及多个其他小程序/App 构建脚本；产品代码主要按微信小程序编写 |
| 质量脚本 | 只有 `type-check`；没有 lint、单元测试、契约测试、端到端测试或安全扫描脚本 |

## 文件与依赖关系

```text
src/main.ts
└─ App.vue
   ├─ stores/app.ts       系统信息、首页缓存时间
   ├─ stores/user.ts      AccessToken、用户、未读数
   └─ api/request.ts      API Origin、认证、401 刷新

pages/index/index.vue
├─ api/request.ts
├─ stores/app.ts
├─ stores/user.ts
└─ types/api.ts

pages/login/index.vue
├─ api/request.ts
├─ stores/user.ts
└─ types/api.ts

components/custom-tab-bar/index.vue
└─ stores/cart.ts
   ├─ api/request.ts
   └─ types/api.ts
```

`pages.json` 注册 4 个 Tab 页和 10 个普通页。`manifest.json` 的应用名、通用 AppID 和微信 AppID 均为空，微信开发配置暂时关闭 URL 校验。

## API 与后端契约

| 小程序调用 | 后端实际接口 | 对照结果 |
|---|---|---|
| `POST /api/v1/auth/sms/send` | 同路径 | 路径一致 |
| `POST /api/v1/auth/sms/verify` | 同路径 | 请求字段不一致：小程序发 `privacyAgreed`，后端只读 `agreedToPrivacy`；首个新用户无法注册 |
| `POST /api/v1/auth/refresh` | 同路径 | 后端只从 HttpOnly `refresh_token` Cookie 读取；小程序端不能依赖浏览器 Cookie 自动维护，当前续期不可用 |
| `POST /api/v1/auth/logout` | 同路径 | AccessToken 鉴权一致；后端撤销该用户全部会话，不只是当前设备 |
| `GET /api/collab/works` | 同路径 | 后端返回 `{works,total,page,limit}`，小程序按 `{items,hasMore}` 读取，首页首轮请求后会得到 `undefined` 列表 |
| `GET /api/notifications/unread-count` | `/api/creator/notifications/unread-count` | 路径缺 `/creator`，且后端仅允许 `role >= 1`，普通用户没有该通知接口 |
| `GET /api/cart` | 同路径 | Store 类型期待 `itemCount` 和数值总价；后端返回 `totalSelected`、字符串总价及不同 CartItem 字段 |
| `POST /api/cart/add` | 同路径 | Store 发 `{skuId,collabWorkId,quantity}`；后端必填 `{itemType,contentId,hardwareSkuId}`，请求会返回 400 |
| 购物车更新/删除 | 同路径 | 路径基本一致，但当前购物车页面未调用 Store，尚无用户入口 |

### 类型漂移

- 登录响应中的用户是扁平结构：`nickname`、`avatarUrl` 在用户对象顶层；小程序 `UserInfo` 要求 `profile` 嵌套对象，还声明后端响应未返回的 `status`。
- 联名列表不返回小程序类型所要求的 `animationFrames`、`sizes`、`shelfStatus`、`priceRange` 和 `creator.bullLevel`；创作者 ID 字段也是 `userId`，不是 `id`。
- 后端联名分页字段是 `works`，不是通用类型中的 `items`，也不返回 `hasMore`。
- 后端 CartItem 使用 `hardwareSkuId`、`contentId`、`snapshotPrice/currentPrice`、`status`；小程序仍使用 `skuId`、`collabWorkId`、`priceChanged` 和嵌套 `sku/collabWork`。

这些不是只影响 TypeScript 的命名问题：首页加载、新用户注册和加购会直接失败。

## 认证与请求层

### 当前流程

1. 登录成功后把 AccessToken 放入 Pinia 和本地 `_at`。
2. 请求封装为受保护接口自动加 `Authorization: Bearer ...`。
3. 遇到 401 时，只允许一个请求调用刷新接口，其他请求进入等待队列。
4. 刷新成功后重试；失败则清登录态并跳登录页。

### 已确认问题

- uni-app 官方请求文档说明，小程序端不会自动保持 Cookie，`withCredentials` 仅 H5 支持；当前 HttpOnly Cookie 刷新模型不能直接用于微信小程序。
- 刷新失败时代码直接清空 `refreshSubscribers`，没有 reject 已排队 Promise；并发 401 下，部分页面请求可能永远不结束。
- `clearAuthAndRedirect()` 调用 `store.logout()`；该动作只清本地状态，注释要求的后端登出在刷新失败场景不会发生。刷新凭证已经不可用时影响有限，但行为和规范表述不一致。
- AccessToken 只恢复“已登录”布尔值，没有随启动加载用户资料；冷启动后“我的”页可能处于已登录但无用户信息状态。
- 请求没有统一超时、取消、重试上限、请求 ID 或错误码分层；`manifest.json` 也未配置 `networkTimeout`。

## 页面与资源事实

- 首页实现双列瀑布流、下拉刷新、触底分页和 `lazy-load` 图片，符合一部分性能规范；但服务端不支持页面传入的 `tag` 筛选，且返回契约不匹配。
- 首页缓存只记录时间，不缓存作品数据。冷启动时 `homeDataLastFetch=0` 会请求；进程内 5 分钟内页面重建可能因为“数据未过期”而保持空数组。
- `App.vue onShow` 每次已登录回前台都会请求未读数，没有时间戳或脏标记，违反本工程 `RULES.md` 的生命周期请求规则。
- 自定义 TabBar 从 Cart Store 读取数量，但应用启动和购物车页都没有调用 `fetchCart()`，徽标始终无法可靠恢复。
- `pages.json` 引用 8 张 Tab 图标；页面另引用 `placeholder.png` 和 `avatar-default.png`，但 `src/static/` 实际只有 `logo.png`。
- 登录页的用户协议和隐私政策是普通文字，没有可打开的正式文档入口；倒计时也没有在页面卸载时清理。
- 代码没有 `uni.login`、微信手机号授权、OpenID/UnionID 绑定或订阅消息授权，当前仅支持短信账号概念。

## 配置与发布边界

| 项目 | 当前事实 | 发布影响 |
|---|---|---|
| 开发 API | `http://localhost:3001` | 开发者工具可访问，手机真机不能把 localhost 当作开发电脑 |
| 生产 API | `https://api.mowobox.com`，代码注释仍写“上线前替换” | 需确认域名所有权、DNS、证书、网关和合法域名配置 |
| 微信 AppID | 空 | 无法完成正式微信构建、预览与发布配置 |
| `urlCheck` | `false` | 只适合本地开发，不应作为正式发布依赖 |
| 隐私配置 | 未见小程序隐私接口声明和用途配置 | 上传图片、手机号、地址前需按实际能力补齐并过审 |
| App 权限 | Android 模板列出相机、账户、电话状态、日志、写设置等广泛权限 | 若不发布 App 不影响微信；若未来发布 App，应按最小权限重建清单 |

## 安全、性能和一致性风险

| 优先级 | 风险 | 影响 | 建议方向 | 复杂度 |
|---|---|---|---|---|
| P0 | 新用户协议字段不匹配 | 没有存量用户时，所有首批注册都会失败 | 生成共享 API 契约并统一字段，补新用户集成测试 | 低 |
| P0 | Refresh Token 仅 Cookie，小程序不保存 Cookie | 15 分钟后会话无法续期 | 为小程序设计设备级刷新凭证或微信会话交换；服务端哈希存储、轮换、撤销和设备绑定 | 高 |
| P0 | 首页分页结构不匹配 | 首页真实数据无法正常展示 | 统一 DTO，明确 `works/items` 和 `hasMore` | 低 |
| P0 | 加购字段不匹配 | 商品无法加入购物车 | 小程序改用后端领域字段并补契约测试 | 低中 |
| P1 | 并发刷新失败不释放等待请求 | 多请求同时过期时页面长期 loading、资源悬挂 | 等待队列同时保存 resolve/reject，失败统一结算 | 中 |
| P1 | 缺 AppID、合法域名、资源和隐私声明 | 无法完成真机发布验收 | 建立开发/预发/生产配置和发布清单 | 中 |
| P1 | 订单、地址、支付、上传、作品详情均未实现 | 核心购买链路不闭环 | 先确认首发范围，再按浏览→详情→加购→结算→支付→订单顺序实现 | 高 |
| P1 | 当前后端支付仍为 Mock 且未验签 | 即使补页面也不能真实收款 | 支付后端专项整改先于小程序上线 | 高 |
| P2 | 类型由人工维护且大面积漂移 | 后续每个页面都会重复踩契约错误 | 从 OpenAPI/JSON Schema 生成客户端类型和校验 | 中 |
| P2 | onShow 无条件请求、Cart 未初始化 | 额外流量且徽标状态不正确 | 按用户/数据类型建立 TTL 或脏标记 | 低中 |
| P2 | 无自动测试、lint、可结束的类型检查证据 | 回归依赖人工，发布信心不足 | 修复 type-check 性能，增加 API 契约和微信核心流程自动化 | 中高 |

## 必须修复与产品决策

不需要产品选择即可修复：协议字段、分页 DTO、购物车 DTO、通知路径或调用边界、静态资源、刷新等待队列、缓存空页、配置分层和自动检查。

已确认：首发只支持微信小程序；使用微信身份并在付款前绑定验证手机号；普通用户通知覆盖审核、付款、订单、发货、售后和账号安全；首发交易边界见 `docs/OPEN_QUESTIONS.md` 的阶段性决策。仍待确认的是正式 AppID/API/资源域名，以及进入真实支付阶段前的微信主体和支付配置。

## 相关文档

- `../xiaochengxu/RULES.md`：小程序原始开发规范
- `docs/modules/foundation-auth-security.md`：主后端认证和会话
- `docs/modules/commerce-orders-inventory.md`：购物车、支付、地址和订单
- `docs/modules/collab-creator-revenue.md`：联名列表与详情
- `docs/DOC_CODE_DIFFERENCES.md`、`docs/OPEN_QUESTIONS.md`
