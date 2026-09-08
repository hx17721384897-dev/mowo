# 基础设施、认证与上传

> 调查日期：2026-08-11
> 本轮覆盖：服务入口、Prisma/JWT/OSS 插件、旧认证、新认证、Token、安全服务、短信服务、上传路由、Web 公共鉴权脚本。
> 已覆盖：`account.js` 与 `settings.js` 的账户、安全、偏好和注销调用。
> 2026-08-13 更新：注销跨域约束、到期执行和统一账号状态检查已完成首版；隐私设置的公开查询语义仍待社区启用前核对。
> 2026-08-13 安全收尾：验证码、联络和上传已接入数据库限流；用户协议/隐私政策改为可阅读页面并保存独立版本记录；首发功能开关和基础安全响应头已启用。
> 2026-08-13 头像显示修正：普通 API 继续使用 `Cross-Origin-Resource-Policy: same-site`；仅公开头像和带签名的临时文件读取地址使用 `cross-origin`，保证本地静态网页与 API 分端口运行时可以显示图片。该例外不绕过文件归属、业务绑定或签名校验。
> 2026-09-08 迁移基线更新：`20260908103000_add_account_security_schema` 已将 v1 账户所需的账户状态、资料安全、短信、会话和审计结构纳入可重放迁移；空库 52/52 重放及注册/账户读取/当前设备退出冒烟通过。本文较早的调查记录保留为审计背景，涉及 Schema 对齐的剩余范围以 `SCHEMA_MIGRATION_ALIGNMENT_INVENTORY.md` 为准。

## 模块职责

该模块负责 API 服务启动、数据库连接、跨域与 Cookie、JWT 身份解析、用户注册登录、Access/Refresh Token、会话撤销、短信验证码、本地/OSS 私有存储和 Web 前端的公共登录状态。

## 技术实现

- Node.js ESM + Fastify 5。
- `@fastify/cors` 处理跨域并允许 Cookie。
- `@fastify/cookie` 保存 HttpOnly Refresh Token。
- `@fastify/jwt` 签发和验证 Access Token/旧版 Token。
- Prisma 单例挂到 `fastify.prisma`。
- 存储适配器支持开发环境本地私有目录和正式环境阿里云 OSS；新上传统一登记用途、所有者和业务绑定。
- 密码使用 `bcryptjs`，新哈希 cost=12，旧哈希登录成功后尝试透明升级。
- 短信服务直接调用阿里云 SMS RPC API，也支持 `SMS_MOCK=true` 开发模式。

## 文件与依赖关系

| 文件 | 作用 | 直接依赖 / 被谁使用 |
|---|---|---|
| `content-service/src/index.js` | 服务唯一入口、插件和全部路由注册、审计 Hook、启动定时任务 | 引入所有插件、路由、`scheduler.js`、`bull-scheduler.js` |
| `plugins/prisma.js` | 创建一个 PrismaClient、启动连接、关闭时断开 | 所有路由通过 `fastify.prisma` 使用 |
| `plugins/jwt.js` | 注册 JWT，装饰 `authenticate`、`requireRole`、`requireNotLimited`、`requireNotBanned` | 依赖 `lib/security.js`；各路由通过 Fastify 装饰器使用 |
| `plugins/oss.js` | 提供本地/OSS存储适配、签名读取和服务端写入兼容层 | `routes/upload.js` 以及其他上传/下载代码使用 |
| `lib/private-files.js` | 文件用途、大小类型、内容识别、所有权和员工读取矩阵 | 上传、联络、售后、创作者草稿使用 |
| `lib/auth.js` | 密码哈希、验证、旧 Token、登录失败锁定 | `routes/auth.js`、`routes/auth-v1.js`、账户相关路由 |
| `lib/token.js` | 生成 15 分钟 Access Token、30 天 Refresh Token 和 Cookie | `routes/auth-v1.js` |
| `lib/security.js` | 封禁/限制检查、撤销所有会话 | `plugins/jwt.js`、`routes/auth-v1.js`、账户安全流程 |
| `lib/account-deletion.js` | 注销阻断检查、资料分类、文件删除、匿名化和失败重试 | `routes/account.js`、`lib/scheduler.js` |
| `lib/sms.js` | 验证码生成、频率/总量控制、验证、阿里云发送 | `routes/auth-v1.js` 和账户变更流程 |
| `lib/rate-limit.js` | 数据库频率计数、标识哈希、短信多维度防刷和验证码失败锁定 | 登录、换手机、注销、联络和上传路由 |
| `lib/features.js` | 首发功能与 API 路径的统一映射 | `index.js` 服务端拒绝；前端读取 `/api/config/features` |
| `routes/auth.js` | 旧版注册、登录、当前用户、资料修改 | 前缀 `/api/auth`；仍被 Web 公共脚本部分调用 |
| `routes/auth-v1.js` | 短信登录注册、密码登录、刷新、登出；旧立即注销入口已退役 | 前缀 `/api/v1/auth` 与 `/api/v1/user` |
| `routes/account.js` | 账户资料、改密、换手机、偏好、隐私、10 分钟保护期注销流程 | 前缀 `/api/v1/account`；`settings.js` 是主要消费者 |
| `routes/upload.js` | 私有文件登记、上传、确认和短期读取 | 前缀 `/api/upload`，依赖 JWT、Prisma 与存储适配器 |
| `frontend/js/auth.js` | 公共登录弹窗、Token 缓存、401 刷新重试、导航用户状态 | 多个 Web 页面引入；同时调用 v1 和旧版认证接口 |
| `frontend/js/settings.js` | 账户设置页交互 | 调用 `/api/v1/account`、上传与地址接口 |

## 服务入口与全局行为

`index.js` 当前顺序是：创建 Fastify（日志开启，body 上限 10 MiB） -> CORS -> Cookie -> Prisma -> JWT -> OSS -> Multipart（5 MiB） -> 审计 Hook -> 注册路由 -> 监听 3001 -> 启动两个进程内 Scheduler。

重要配置行为：

- `CORS_ORIGIN` 缺省时允许 `127.0.0.1:5500`、`localhost:5500`、`localhost:3000`。
- 非生产环境对任意 Origin 放行；无 Origin 的服务端请求也放行。
- `COOKIE_SECRET` 和 `JWT_SECRET` 均存在代码内开发默认值，生产环境没有启动时强制校验。
- 后台请求先经过固定岗位权限 Hook；写操作和后台拒绝访问会写 `operation_logs`，记录员工、方法、路径、IP、结果、状态码、设备会话和浏览器。请求详情先统一脱敏，不记录密码、验证码、Token、完整手机号、地址、快递单号或文件内容。
- Scheduler 直接运行在 API 进程内；如果未来启动多个 API 实例，每个实例都会各自启动任务，除非另加分布式锁或独立任务进程。

## 两套认证系统

> 2026-08-12 整改更新：首发已统一使用新版设备会话。旧 `/api/auth/register`、`/api/auth/login` 永久停用；Web 的当前用户和资料修改已迁到 `/api/v1/account`。每个 Access/Refresh Token 组合绑定独立 `sessionId`，基础鉴权会检查该设备会话和账号当前状态。普通退出只撤销当前设备，另有退出全部设备；密码登录 UI 和新版密码入口首发默认关闭。

### 新版 v1

| 路径 | 功能 | 主要安全措施 |
|---|---|---|
| `POST /api/v1/auth/sms/send` | 按用途发送验证码 | 60 秒冷却；手机号每日 10 次、IP 每小时 30 次、IP 每小时最多尝试 10 个不同手机号 |
| `POST /api/v1/auth/sms/verify` | 短信登录或注册 | 同一 IP 15 分钟内累计 10 次错误后锁 15 分钟；注册事务保存两份协议版本记录 |
| `POST /api/v1/auth/password/login` | 密码登录 | 统一错误文案；5 次失败后锁 30 分钟；bcrypt 透明升级 |
| `POST /api/v1/auth/refresh` | Refresh Token 轮换 | Cookie 原值 SHA-256 后查库；检查撤销、过期和封禁 |
| `POST /api/v1/auth/logout` | 退出当前设备 | 需要 Access Token；只撤销当前 `sessionId` 并清除本设备 Cookie |
| `POST /api/v1/auth/logout-all` | 退出全部设备 | 需要 Access Token；撤销账号下全部设备会话 |
| `POST /api/v1/user/account/deactivate` | 旧立即注销入口 | 固定返回 410；客户端必须使用 `/api/v1/account/deactivate/*` |

新版 Access Token 有效期 15 分钟；Refresh Token 原值只放 HttpOnly Cookie，数据库保存 SHA-256；Refresh Token 有效期 30 天且每次刷新轮换。Access Token 仍保存在 Web `localStorage` 中。

### 旧版 `/api/auth`

旧版 `/api/auth/register` 和 `/api/auth/login` 已永久停用，不再签发 7 天 JWT。旧 `/me` 和资料接口暂时保留给尚未完成逐页迁移的内部消费者，但 Web 公共脚本和款式管理页已改用 `/api/v1/account`。未来恢复密码登录时只启用新版 `/api/v1/auth/password/login`，首发默认关闭。

## JWT、设备与员工岗位

- 兼容旧 payload `{ userId, phone, certifyStatus, role }` 和新 payload 中额外的 `sub`。
- `authenticate` 完成 JWT 验签、`sub -> userId` 兼容，并回查设备会话、封禁、账号状态、角色、岗位和创作者认证状态。
- `requireRole(minRole)` 继续用于旧路由兼容；真正的后台区域权限由 `staffRole` 和 `permissions.js` 判断。
- 固定岗位为 `OWNER`、`CUSTOMER_SERVICE`、`PRODUCTION`、`COLLAB_OPS`；详细权限表见 `staff-permissions-audit.md`。
- `requireNotLimited` 仍按资金业务显式组合；基础 `authenticate` 已统一阻止封禁、停用、已注销账号和无效设备会话。
- 每次基础鉴权都会回查设备会话、账号状态、数据库当前 `role` 和 `staffRole`，岗位变化后旧 Token 立即失效。
- `PENDING_DELETE` 账号只能查询、撤销注销、退出登录和处理已有订单，不能修改资料、创建订单、申请合作、提现或签发新的上传权限。
- 注销申请会立即撤销全部设备。设置页同步清除本地登录信息；用户点击撤销时使用页面内公共登录弹窗重新验证，登录完成事件会自动继续撤销请求。项目没有独立 `auth.html`，统一路由的登录回退指向 `pages/index.html?auth=1` 并打开登录弹窗。
- 验证码登录与注册必须显式传递 `mode=LOGIN/REGISTER`。登录手机号不存在时提示前往注册，不能自动创建账号；注册手机号已存在时提示返回登录。只有注册面板要求勾选《用户协议》和《隐私政策》，撤销注销属于原账号重新验证，不重复走注册同意流程。

## 账户设置流程

`routes/account.js` 提供 16 个接口，前端 `settings.js` 已连接这些接口：

| 功能 | 后端行为 | 前端行为 |
|---|---|---|
| 完整资料 | 返回脱敏手机号、角色、认证状态、账号状态和 Profile | 设置页初始化并渲染 |
| 昵称检查/资料修改 | 昵称 2-20 字、尝试保证唯一、30 天修改一次；生日需满 13 岁 | 失焦检查昵称，保存后更新用户缓存 |
| 头像 | 先登记用途和大小，再 PUT 并校验真实图片，最后保存受控公开头像地址 | 浏览器裁剪与上传 |
| 设置/修改密码 | 8-20 位且同时含字母数字；已有密码时验证旧密码 | 成功后仍保持当前登录 |
| 换绑手机号 | 验旧手机 -> 5 分钟 Action Token -> 验新手机 -> 更新手机号 -> 撤销所有会话 | 成功后只更新页面中的脱敏号码，当前 Access Token 仍留在本地 |
| 通知设置 | 互动、营销可关；订单、系统通知不可关 | 只提交可变的两个开关 |
| 隐私设置 | 保存 `public/followers/private` | 私密模式前弹确认框 |
| 10 分钟保护期注销 | 检查订单/售后/联名/资金/合同/争议，发 OTP，写独立申请记录并退出全部设备；期满复查、删除或匿名化，失败自动重试并可转人工关注 | 页面展示全部阻断项；保护期内可撤销 |

换绑手机号的 Action Token 绑定用户和 User-Agent，5 分钟过期、一次性使用；当前 Token 原值存入数据库。换绑中的“消费 Action Token、更新手机号、撤销会话、写审计”不是一个原子事务。

密码修改会写合规审计，并保留当前设备、撤销其他设备会话。换绑手机号会撤销全部设备并要求使用新手机号重新登录。

注销的 `deactivate/check`、发送验证码、正式申请和到期执行均复用同一套后端阻断规则；即使跳过页面直接调用申请接口也不能绕过检查。文件删除成功后才执行数据库匿名化；失败记录在 `account_deletion_requests` 并延迟重试。

## 短信验证码

- Mock 模式固定验证码为 `123456`，并在响应中通过 `_devCode` 返回。
- 单手机号、单用途冷却 60 秒；验证码有效 5 分钟；最多尝试 5 次。
- 全局限制以 UTC 小时字符串为 key，每小时 500 次。
- 计数器在手机号冷却检查和真实短信发送之前递增，因此失败/重复请求也消耗全局额度。
- 代码中的错误文案写“今日上限”，实际限制是“每小时上限”。
- 验证码目前以明文存入数据库，而不是哈希。

### 2026-08-13 防刷补充

- 所有新版短信入口共用数据库计数，覆盖登录/注册、换绑旧手机、换绑新手机和账号注销，重启或多实例不能把计数清零。
- 频率表只保存 HMAC 后的手机号、IP 或匿名上传标识，不保存手机号原文；命中限制写 `RATE_LIMIT_BLOCKED` 安全记录。
- 固定窗口当前为：手机号每日 10 次、IP 每小时 30 次、同一 IP 每小时最多 10 个不同手机号；验证码错误 15 分钟 10 次后暂停 15 分钟。
- 旧 `sms.js` 的 60 秒冷却和验证码单码最多尝试 5 次继续保留，构成更细一层保护。
- Scheduler 每天删除过期超过 24 小时的限流桶。正式环境仍需要指标、告警、代理 IP 可信链和必要时的人机验证。

## 协议与同意证据

- 注册弹窗只在“注册”面板显示勾选项，登录已有账号不重复要求注册同意。
- 链接已指向 `frontend/pages/user-agreement.html` 与 `privacy-policy.html`，不再是空链接。
- 注册事务分别写入 `ConsentRecord` 的 `USER_AGREEMENT` 和 `PRIVACY_POLICY`，保存版本、场景、时间、IP 和 User-Agent；用户表继续保留隐私版本快照以兼容旧代码。
- 当前版本分别为 `test-2026-08` 和 `dev-2026-08`，页面明确标为邀请测试草案。运营主体、正式联系方式、供应商清单、保存期限和法律审查仍是 B1 前阻断项。
- 当前只完成“注册时留证”；未来协议重大更新后的强制再次确认与拒绝后的限制策略尚未实现。

## 首发功能与响应安全

- `COMMUNITY_ENABLED`、`CREATOR_FINANCE_ENABLED`、`BULL_SYSTEM_ENABLED`、`MOCK_CERTIFICATION_ENABLED` 默认均为 `false`；创作者自助联名已从 B1 源码移除，不再保留该功能开关。
- 服务端先拒绝关闭功能的 API，前端 `feature-flags.js` 再隐藏入口并拦截旧页面直达。前端隐藏不是权限边界。
- API 统一返回 `nosniff`、禁止 iframe、Referrer Policy、Permissions Policy 和缓存控制；生产额外返回 HSTS。CSP 及静态站点响应头仍需由正式 Web 服务器配置。
- 自动验收命令为 `npm run check:launch-safety`。

## 私有文件上传与读取

> 2026-08-13 第三批整改后，详细实现与剩余边界以 `private-file-security.md` 为准。以下旧 OSS 入口仅作历史兼容背景，不代表所有历史 key 已迁移。

| 路径 | 用途 | 当前校验 |
|---|---|---|
| `POST /api/upload/presign` | 单文件登记 | 按用途检查扩展名、MIME、大小；除作品集/简历外需登录；15 分钟上传窗口 |
| `POST /api/upload/presign-batch` | 最多 50 张定制帧 | 需要登录；逐文件执行用途规则 |
| `POST /api/upload/presign-avatar` | 头像登记 | 需要登录；JPG/PNG/WEBP；最大 5 MiB |
| `PUT /api/upload/local/:id` | 本地开发上传 | 一次性令牌；流式大小限制；文件头识别；成功后登记 READY |
| `POST /api/upload/files/:id/complete` | OSS/兼容上传确认 | 核对所有者、实际大小和文件内容类型 |
| `GET /api/upload/presign-get` | 私有对象读取 URL | 本人或有业务需要的员工；必须已绑定；URL 5 分钟有效 |
| `GET /api/upload/public/:id` | 当前公开头像 | 只读取 `READY`、头像用途且已绑定用户资料的文件；允许静态网页跨端口作为图片展示 |

本地模式的 PUT 经过 Fastify 并流式写入私有目录；OSS 模式仍由浏览器直传。两种模式都返回 `objectKey`，业务数据保存 key，查看时才获取短期签名 URL。

### 上传文件对应的真实业务

| 类别 | 当前页面/接口 | 当前实际状态 | 预期访问者 |
|---|---|---|---|
| 联络作品集 | `contact.html` 的画师/IP合作表单 | 图片/PDF登记后绑定具体留言；允许匿名临时上传 | 提交者本人和运营客服/合作运营 |
| 招聘简历 | `contact.html` 的加入哞屋表单 | PDF/Word登记后绑定具体留言；允许匿名临时上传 | 提交者本人和运营客服/负责人 |
| 创作者认证代表作 | `creator-certify.html`、`certify.js` 的 `portfolioUrls` | 页面只读成 Data URL 本地预览，提交是 `setTimeout` 模拟成功，当前没有真正调用认证 API或上传 OSS | 申请者和认证审核管理员 |
| 联名动画原帧 | `collab.js` 联名申请 | 后端接收 Data URI/OSS key，并把 Data URI 帧写入 `collab/{userId}/{workId}/` | 作品公开展示需要派生预览；原帧应限创作者与授权管理/生产人员 |
| 联名帧包 ZIP | `creator.js` 专用上传 URL | 创作者对自己的联名作品和规格上传生产帧包，另有确认接口 | 创作者本人、审核和生产人员 |
| 合同扫描件 | `creator_contracts.attachments` | Schema 有 JSON 附件字段，但合同路由和后台页面没有附件上传/读取实现 | 授权管理员，必要时合同对应创作者只读 |
| 用户定制原图 | 定制上传、`customize_orders.frame_urls`、`frame_instances.image_url` | 属于订单生产资料，不是公开作品附件 | 订单用户、授权客服、生产人员 |

此前“私有文件应该管理员还是用户访问”的问题应拆开处理：联络附件按提交记录授权；联名原帧按作品所有权和内部岗位授权；合同按合同参与方授权；定制原图按订单所有权和生产角色授权。不能继续依赖一个接受任意 key 的通用读取接口。

联络页面继续允许匿名提交；登录身份由后端会话自动确认，不再信任客户端 `submitterUserId`。作品集 20 MiB、简历 10 MiB 现由服务端执行，附件必须绑定同一上传身份和具体留言。

## Web 前端会话行为

`frontend/js/auth.js`：

- 根据浏览器 hostname 在 `127.0.0.1:3001` 与 `localhost:3001` 之间选择 API 地址。
- Access Token 保存为 `localStorage.mowo_token`，用户缓存保存为 `localStorage.mowo_user`。
- 解码 JWT 过期时间，在过期前 2 分钟主动刷新。
- 包装全局 `window.fetch`：API 返回 401 时，只发起一次并发刷新，然后携带新 Authorization 重试。
- Refresh Token 失效后清理本地缓存；管理/创作者页面会跳到首页。
- 当前用户资料接口仍为旧版 `/api/auth/me`。

## 已发现的文档与代码差异

- `docs/API.md` 把 v1 接口写为 `/send-code`、`/login`，当前代码实际是 `/sms/send`、`/sms/verify`、`/password/login`。
- 注销路径和规则差异已解决：正式入口为 `/api/v1/account/deactivate/*`，旧立即注销入口返回 410。
- 原 7 天、48 小时正常等待文案已按 2026-08-13 最终决策改为 10 分钟保护期；Scheduler 每分钟扫描，48 小时只作为异常任务目标。
- `security.js` 注释将改密列为会话熔断场景，`account.js` 的密码修改实际没有撤销任何会话。
- 上传读取接口注释写“管理员用”，代码权限只是普通 `authenticate`。
- 文档将双 Token 描述为推荐方案，但旧版 7 天 Token 仍能注册和登录，并且 Web 仍依赖部分旧接口。

## 安全、性能和一致性风险

以下是代码事实推导出的调查结论，本批次只记录、不修改：

1. **已解决：旧认证绕过。** 旧注册/登录入口已永久停用，新版密码入口首发默认关闭。
2. **已解决：设备会话与账号状态。** 基础鉴权统一检查 `sessionId` 对应会话、账号封禁/停用状态和数据库当前角色；撤销后 Access Token 立即失效。
3. **已解决：通用安全记录脱敏。** 改密、换手机、验证码、手机号、地址、快递单号和文件内容不再原样进入 `operation_logs`；旧高风险详情已统一清理。
4. **已解决核心层：新私有文件读取授权。** `/presign-get` 只处理登记且已通过校验的文件，普通用户限本人，员工按用途与业务绑定读取；历史 OSS key 和旧帧包入口仍待迁移。
5. **部分解决/仍高：恶意文件扫描。** 新上传已核对大小、扩展名、MIME 和文件头，不再接受 `octet-stream` 兜底；DOC/DOCX/ZIP 的病毒、宏和压缩炸弹扫描尚未接入。
6. **中：生产密钥未做启动失败保护。** 缺少环境变量时会使用可预测默认 JWT/Cookie secret。
7. **已解决：员工岗位即时生效。** 基础鉴权回查数据库角色、岗位和账号状态，员工岗位变化同时撤销全部设备会话。
8. **中：Access Token 在 localStorage。** 一旦页面发生 XSS，Token 可被读取；Refresh Token 的 HttpOnly 设计只能保护刷新凭证。
9. **部分解决/中：短信已有多维数据库防刷。** 已有手机号、IP、不同目标数和错误次数限制；尚无可信代理 IP 配置、图形验证码、指标告警或高流量下的 Redis/网关限流。
10. **中：进程内定时任务影响横向扩容。** 多实例会重复执行，单实例崩溃时任务也停止。
11. **中：刷新轮换不是单事务。** 旧 Refresh Token 先被撤销，再创建新 Token；中间失败会导致用户需要重新登录。
12. **已解决：按设备退出。** 普通退出只撤销当前设备；账号设置另有退出全部设备入口。
13. **已解决（首版）：注销到期执行。** 每 1 分钟扫描保护期已满的申请，执行前复查，删除或匿名化并记录审计；连续失败 3 次或持续 1 小时转人工关注。正式多实例部署仍需独立 Worker 和站外告警。
14. **已解决：注销前置条件不可绕过。** 检查、发送 OTP、申请和到期执行共用跨业务规则。
15. **已解决：`PENDING_DELETE` 统一限制。** 基础鉴权回查数据库状态，旧地址、订单、联名和创作者自定义鉴权也已统一接入。
16. **已解决：账号安全请求脱敏。** 通用日志统一清除密码、OTP、Action Token 和完整手机号。
17. **已解决：改密后的其他设备。** 设置或修改密码后保留当前设备，其他设备会话立即撤销。
18. **中：换手机流程不是原子事务。** Action Token 先标记使用，之后才更新手机号和撤销会话；后续失败时用户可能必须从头验证。
19. **中：昵称唯一性仅由查询保证。** Schema 没有昵称唯一约束，并发提交仍可能产生重复昵称。
20. **中/跨模块：隐私设置是否真正生效尚未验证。** 当前只确认设置值会保存，公开用户/内容接口将在后续批次核对过滤逻辑。
21. **已解决：公开联络账号绑定。** 登录身份只由后端会话确认；匿名提交不伪造注册用户 ID。
22. **已解决核心层：联络附件业务绑定。** 文件必须属于同一登录/匿名上传身份并绑定具体留言，后台只为匹配当前留言的文件签发短期链接。
23. **已解决核心层：服务端文件大小与类型。** 新上传按用途检查声明大小、实际大小、扩展名、MIME 和文件头；病毒、宏和压缩炸弹扫描仍未完成。
24. **中：创作者认证页面是演示流程。** 代表作未上传，最终提交未调用 `/api/certify`，页面成功状态不能代表数据库状态。

## 待确认事项

1. 旧 `/api/auth/register` 和 `/api/auth/login` 是否仍需兼容已上线客户端，还是仅为开发遗留？
2. **已确认并实现：**账号注销采用 10 分钟防误操作保护期，保护期内可撤销，申请后禁止新增业务；48 小时仅为异常处理目标。
3. **已确认并实现：**普通用户可读取自己的已完成文件；员工只可按岗位读取已绑定业务的文件，负责人也不能查看未提交的孤立上传。
4. Web 正式部署是否与 API 同域？这会影响 CORS、Cookie `sameSite`、CSRF 和 Token 存储方案。
5. **已确认：** 头像菜单和“退出当前设备”只退出当前浏览器；“退出全部设备”才撤销账号下所有会话。
6. 上传的 PDF、Word、ZIP 是否确实属于正式业务需求；如果是，需要确定扫描、隔离和下载响应策略。
7. **已确认并实现：**处理期允许查询、撤销、退出和处理已有订单，禁止新增业务。
8. **已确认并实现：**进行中订单、售后/争议、联名销售、未结收益/储备金/提现和有效合同均阻止注销。

账号注销的最终规则、数据处置矩阵、代码入口和剩余部署风险详见 `docs/ACCOUNT_DELETION_POLICY.md`。

## 相关文档

- `docs/ACCOUNT_FILE_SECURITY_ACCEPTANCE.md`：本模块的完整人工验收流程和测试账号分工。
- `docs/TROUBLESHOOTING.md`：头像 `NotSameSite 302`、空 JSON 请求和本地双端口问题的排查记录。
- `CLAUDE.md`：技术栈、JWT、角色、环境变量和开发约束。
- `docs/API.md`：对外接口说明，当前有路径差异。
- `docs/ARCHITECTURE.md`：部署、OSS 与端职责规划。
- `docs/DATABASE.md`：账户安全相关数据表说明。
- `../xiaochengxu/RULES.md`：小程序 Token 与请求拦截规则。
