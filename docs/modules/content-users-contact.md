# 内容社区、用户、认证与联络

> 调查日期：2026-08-12
> 本轮覆盖：文章、混合信息流、评论/点赞/收藏/关注、公开用户页、创作者认证、创作者通知、联络表单、留言后台和用户后台的交叉部分。
> 2026-08-13 更新：社区与模拟认证已由服务端开关默认关闭；联络改用数据库 IP 限流（每小时 5 次），登录身份和附件归属整改保持有效。
> 已完成：逐路由阅读、Prisma Schema 与迁移对照、Web 消费者检索，以及 `API.md`、`DATABASE.md`、`FRONTEND.md`、`CLAUDE.md` 对照。
> 边界：社区页面的完整视觉和逐页前端审计留在 Web 批次；本文件已核对与本模块直接有关的请求和断链。
> 工作区事实：项目尚未正式上线、没有真实用户；本轮只补调查文档，不修改业务代码。
> R1-B 更新（2026-09-14）：社区、互动、公开创作者页和模拟认证的路由、页面及无消费者 Schema 已物理删除。下文关于这些能力的描述仅是 2026-08 历史审计；当前模块只保留用户基础能力与联络功能，不得按下文恢复旧实现。
> V1c 更新（2026-09-16）：Vue `/app/contact` 已完成自动验收；公开提交不再接受客户端用户 ID，附件按匿名会话/登录身份与业务记录绑定，附件类型及 `extra`/外链均由服务端白名单约束。旧 `contact.html` 仅暂作人工视觉确认基线，确认后删除。以下 2026-08 的页面、接口和风险段落是审计快照，不代表现行实现。

## 模块职责与当前阶段

该业务域原计划承担四件事：

1. 用户或创作者发布文章，并关联可购买商品。
2. 用户浏览混合信息流，进行点赞、收藏、评论和关注。
3. 展示创作者公开主页，并把普通账号认证为创作者。
4. 收集画师、渠道、媒体、求职、反馈和工厂合作信息，供管理员处理。

当前并不是一个完整上线的社区：

- 后端社区路由全部注册并可访问。
- `community.html` 和 `work-detail.html` 已移到 `frontend/pages/_legacy/`，符合“许可证到位后再上线社群”的规划。
- 现行 `creator-profile.html` 仍使用公开用户、文章、商品和关注 API，并链接到不存在于现行目录的 `work-detail.html`。
- `orders.html` 和 `order-detail.html` 仍链接到不存在于现行目录的 `community.html`。
- 认证页面看似完整，但实名、代表作上传和最终提交均为前端模拟。
- 联络表单和后台管理有真实接口，但登录身份、附件归属和限流设计尚不满足企业上线要求。

## 技术实现

- 后端：Fastify 5 路由、Prisma 5、PostgreSQL。
- 前端：静态 HTML + 内联原生 JavaScript，公共登录逻辑来自 `frontend/js/auth.js`。
- 文件：联络作品集和简历通过阿里云 OSS 预签名 URL 直传，数据库只存对象 key 的 JSON 字符串。
- 内容聚合：`/api/feed` 分别查文章和旧 `Product`，在 Node.js 内存中合并、排序和分页。
- 计数：文章浏览/点赞/收藏/评论、用户粉丝/关注和获赞均保存冗余计数并直接增减。
- 审核：文章是否直发只由 `CreditScore >= 80` 决定；认证由管理员接口审核。
- 反垃圾：联络表单使用进程内 `Map/Set` 做按 IP 计数和封禁，并把封禁标记写回 PostgreSQL。

## 文件与依赖关系

| 文件 | 作用 | 主要依赖 / 消费者 |
|---|---|---|
| `src/routes/articles.js` | 文章发布、列表、详情、编辑、删除、点赞、收藏、评论 | `Article`、`ArticleProduct`、`Comment`、`Like`、`Collect`、`UserProfile` |
| `src/routes/feed.js` | 文章与旧商品混合信息流 | `Article`、`Product`；遗留 `community.html` |
| `src/routes/users.js` | 公开用户页、用户文章、关注状态和关注切换 | `User`、`UserProfile`、`CreatorProfile`、`Follow`；`creator-profile.html`、联名确认页 |
| `src/routes/certify.js` | 认证提交、状态和管理员审核 | `CertifyApplication`、`User`、`CreatorProfile`、`CreatorReserve`、`BullScoreLog` |
| `src/routes/notifications.js` | 创作者通知列表、未读数、单条/全部已读 | `CreatorNotification`；通知写入来自 `admin-collab.js` |
| `src/routes/contact.js` | 六类公开联络提交、内存限流和垃圾检测 | `ContactSubmission`、`OperationLog`、OSS key |
| `src/routes/admin-contact.js` | 留言筛选、详情、状态、星标、备注、删除和封 IP | `ContactSubmission`、OSS 签名、`OperationLog` |
| `src/routes/admin.js` | 用户列表、角色修改、封禁/解封 | `User`、`OperationLog`；`admin-users.html` |
| `src/index.js` | 注册上述路由、全局审计、功能开关和基础安全响应头 | 普通 API 保持同站资源隔离；公开头像及签名文件地址可供本地静态网页跨端口展示 |
| `prisma/schema.prisma` | 数据关系、唯一约束和冗余计数字段 | 迁移目录决定空库实际结构 |
| `frontend/pages/_legacy/community.html` | 遗留社区列表、点赞和详情预取 | `/api/feed`、`/api/articles/*` |
| `frontend/pages/_legacy/work-detail.html` | 遗留文章/商品详情和互动 | 文章详情、评论、点赞、收藏 |
| `frontend/pages/creator-profile.html` | 当前公开创作者主页 | 用户、用户文章、旧商品和关注 API |
| `frontend/pages/creator-certify.html` | 认证四步页面 | 当前没有认证 API 调用，作品只存 Data URL |
| `frontend-vue/src/views/ContactView.vue` | 当前六类联络入口与数据驱动弹窗 | `/api/upload/presign`、`/api/contact` |
| `frontend/pages/contact.html` | V1c 前旧联络页，2026-09-17 已物理删除 | 只由固定 Git 历史视觉基线读取 |
| `frontend/pages/admin-contact.html` | 留言运营后台 | `/api/admin/contact/*` |
| `frontend/pages/admin-users.html` | 用户角色和封禁后台 | `/api/admin/users/*` |

## API 与权限

### 文章和信息流

| 方法与路径 | 权限 | 当前行为 |
|---|---|---|
| `POST /api/articles` | 登录 | 根据信用分直接发布或进入 pending，可关联任意 `productIds` |
| `GET /api/articles` | 公开 | 只列出 published，按标签字符串包含匹配并分页 |
| `GET /api/articles/:id` | 公开 | 除 removed 外均可读取，读取即同步增加浏览量 |
| `PUT /api/articles/:id` | 作者 | 修改标题/正文/封面/标签，不重新进入审核 |
| `DELETE /api/articles/:id` | 作者 | 把状态改为 removed，并把文章计数减一 |
| `POST /api/articles/:id/like` | 登录 | 点赞切换，同时修改文章和作者获赞计数 |
| `POST /api/articles/:id/collect` | 登录 | 收藏切换并修改文章收藏计数 |
| `POST /api/articles/:id/comments` | 登录 | 创建顶级评论或回复并修改评论计数 |
| `GET /api/articles/:id/comments` | 公开 | 分页返回顶级评论，每条附最早三条回复 |
| `GET /api/feed` | 公开 | 合并文章和旧商品，支持标签、只看商品和排序 |

没有找到文章待审列表、通过/拒绝、评论删除、评论点赞、内容举报或举报审核接口。`Report` 表存在，但没有代码消费者。

### 用户和关注

| 方法与路径 | 权限 | 当前行为 |
|---|---|---|
| `GET /api/users/:id` | 公开 | 返回用户基本资料、统计和创作者资料 |
| `GET /api/users/:id/articles` | 公开 | 返回该用户 published 文章 |
| `POST /api/users/:id/follow` | 登录 | 关注切换并修改双方冗余计数 |
| `GET /api/users/:id/follow-status` | 登录 | 查询关注关系 |

公开查询没有执行 `profileVisibility`，也没有排除注销冷静期、停用或被封禁账号。隐私设置目前只被保存，没有落实到发现、主页和内容查询。

### 创作者认证

| 方法与路径 | 权限 | 当前行为 |
|---|---|---|
| `POST /api/certify` | 登录 | 保存申请并把 `certifyStatus` 改为 1 |
| `GET /api/certify/status` | 登录 | 返回账号状态和最新申请摘要 |
| `PUT /api/certify/review/:applicationId` | role >= 2 | 通过或拒绝；通过时初始化创作者资料、储备金和牛量日志 |

没有认证申请列表、申请详情和审核后台页面。管理员即使知道接口，也缺少发现 `applicationId` 的正常入口。

### 通知

- `GET /api/creator/notifications/unread-count`
- `GET /api/creator/notifications`
- `POST /api/creator/notifications/:id/read`
- `POST /api/creator/notifications/read-all`

这些接口用 `role >= 1` 判断“创作者”，认证审核却只把 `certifyStatus` 改为 2，不会把普通用户 `role` 改为 1。因此正常认证通过的普通账号可能仍无法访问通知。当前通知只由联名审核/上下架写入；文章点赞、评论、回复、关注和系统通知均没有写入链路，也没有读取用户通知偏好。

### 联络和用户后台

- `POST /api/contact`：公开提交，无 Token 校验。
- `/api/admin/contact/*`：role >= 2 可读写，删除和手动封 IP 要求 role >= 3。
- `GET /api/admin/users`、`PUT /api/admin/users/:id/ban`：role >= 2。
- `PUT /api/admin/users/:id/role`：role >= 3。

## 数据模型与索引

| 模型 | 关键事实 |
|---|---|
| `Article` | 正文、状态和四种计数集中保存；标签是 JSON 字符串，不是数组/关系表 |
| `ArticleProduct` | 文章与旧 `Product` 多对多，组合唯一 |
| `Comment` | 自关联回复；`replyToUserId` 只是字符串，没有外键关系 |
| `Like` | 多态 `targetType + targetId`，只有用户外键，目标不存在数据库外键 |
| `Collect` | 用户与文章组合唯一 |
| `Follow` | 关注者与被关注者组合唯一 |
| `UserProfile` | 保存可见性、通知偏好和冗余社交计数 |
| `CertifyApplication` | 保存实名、身份证后四位、声明勾选和作品 URL JSON |
| `CreatorNotification` | 用户维度有未读和时间索引，仅服务创作者联名通知 |
| `ContactSubmission` | 保存联系方式、IP、User-Agent、附件 key、处理状态和内部备注 |

规模化查询缺少关键索引：

- `Article(status, createdAt)`、`Article(userId, status, createdAt)`。
- `Comment(articleId, parentId, status, createdAt)`。
- `CertifyApplication(userId, appliedAt)` 和待审状态索引。
- 联系表单虽有 type/status/ip/createdAt 单列索引，但后台常用的状态+时间、类型+状态+时间组合查询没有复合索引。
- `Like` 的多态目标无法由数据库保证目标存在，按目标统计也没有目标前缀索引。

## 关键流程事实

### 文章发布与审核

1. 任意登录用户提交标题和正文。
2. 没有信用记录时按 100 分处理；80 分以上直接 published，否则 pending。
3. 同一事务创建文章、关联商品并增加 `articleCount`。
4. pending 没有后台审核入口；published 修改后不会重新审核。

这意味着信用分只能决定文章是否进入一个没有出口的队列，无法形成企业级内容治理。

### 互动计数

点赞、收藏和关注都是“先查关系是否存在，再创建/删除，并增减计数”。事务保证单次请求内部一致，但两个同用户的并发请求可能同时读到“不存在”，随后一个请求触发唯一约束错误；重复删除文章还能再次减少文章数。冗余计数也没有校准任务，长期可能出现负数或与关系表不一致。

### 混合信息流

`/api/feed` 没有把分页条件传给两张表，而是读取全部匹配文章和全部匹配商品，在 API 进程中合并排序后才截取一页。数据量增长后，数据库传输、Node.js 内存、排序 CPU 和响应时间都会随全量内容线性增长，无法承载大批量访问。

### 认证

后端把客户端提交的 `certifyPassed: true` 当成第三方实名已通过的证据，没有服务端核验凭证、回调签名或供应商流水号。前端则固定延时两秒后显示通过，最后再固定延时显示“申请成功”，没有上传代表作，也没有调用后端。审核接口存在但没有申请列表和运营页面。

### 联络附件

1. 登录页面先调用通用上传预签名接口，把文件直传 OSS。
2. 页面把返回 key 放进公开 `/api/contact` 请求。
3. 管理员详情接口对数据库中的每个 key 直接生成读取签名。

服务端没有证明这些 key 由提交者上传、属于联络目录或属于这条记录。攻击者可直接调用公开提交接口填入猜到的其他 OSS key，诱使管理员接口为其签名，属于对象级授权缺口。

## 前端消费者与可用状态

| 页面 | 当前状态 | 对接事实 |
|---|---|---|
| `_legacy/community.html` | 遗留、无现行导航 | 真实调用 feed、点赞和文章详情；输出未可信标题/作者/封面到 HTML |
| `_legacy/work-detail.html` | 遗留 | 真实调用文章、评论、点赞和收藏；正文用 `innerHTML` 输出，重新上线前存在存储型 XSS 风险 |
| `creator-profile.html` | 现行 | 真实拉用户、文章和旧商品；关注成功后错误读取 `json.data.following`，后端实际返回根级 `following` |
| `creator-certify.html` | 现行入口、演示逻辑 | 无 `/api/certify` 调用；还把字符串 Token 当 JSON 解析，侧栏信息通常无法正常读取 |
| Vue `/app/account/settings` | 现行 | 由可信会话校准后渲染当前账户资料与安全能力；旧设置页已删除，创作者自助申请不在首发范围 |
| `contact.html` | 现行 | 前端强制登录和上传附件，但提交请求不带 Authorization，只把 localStorage 用户 ID 放入 body |
| `admin-contact.html` | 现行 | 真实接通列表、统计、详情、状态、星标和备注；删除/封 IP 后端有接口但页面无入口 |
| `admin-users.html` | 现行 | 真实接通列表、改角色和封禁；页面发送 `keyword`，后端列表忽略该参数，搜索/高亮找人可能失效 |

`creator-profile.html` 还会把标签、社交 URL、作品标题等数据库值拼进 `innerHTML` 或 `href`，缺少统一转义和 URL 协议白名单。社区重新上线前应建立统一安全渲染规则，而不是逐页面补丁。

## 文档与代码差异

- `FRONTEND.md` 明确初期不开放社交互动，但后端公开路由始终注册；现行页面还残留社区断链。
- `API.md` 只列出用户和认证路由组，没有记录文章、feed、联络及本批接口明细。
- `FRONTEND.md` 称联络必须登录，后端却公开并信任 `submitterUserId`。
- `FRONTEND.md` 称认证页面可完成申请，实际为全模拟；后端审核接口没有管理页面。
- 后端认证成功文案为 1-3 个工作日，设置页写 3-5 个工作日。
- `UserProfile.profileVisibility` 和通知开关已有文档/字段，但公开查询和通知生产没有使用。
- `test.http` 是带固定 Token/ID 的手工请求样例，不是可重复执行的自动化测试。

详细编号见 `docs/DOC_CODE_DIFFERENCES.md` 的 D-014、D-015、D-017 和 D-047 至 D-056。

## 安全、性能和一致性风险

### 上线前阻断项

1. **高：认证可伪造。** 客户端布尔值被当作实名通过证据；页面又完全模拟，不能用于真实创作者准入。
2. **已解决核心层：联络附件归属。** 附件必须来自同一登录账号或匿名上传会话，并在提交事务中绑定具体留言；岗位读取按文件用途控制。
3. **高：内容可见性与隐私失效。** 知道 ID 即可读取 pending/rejected 文章，用户公开页忽略私密设置和账号状态。
4. **高：存储型 XSS。** 遗留文章页直接把正文写入 `innerHTML`，现行创作者页也拼接未可信字段和 URL；社区启用前必须统一处理。
5. **高：缺少内容治理闭环。** 没有文章审核后台、举报接口、评论删除/屏蔽、敏感内容服务和操作申诉。

### 承载量和一致性

6. **高：feed 全量加载后分页。** 内容增长后会直接拖垮数据库、网络和 API 内存。
7. **中高：每次详情访问同步写浏览量。** 热门文章会形成单行写热点，且任何人可重复刷新刷量。
8. **中高：互动切换存在并发竞态。** 关系唯一约束能阻止部分重复数据，但接口会报错，冗余计数可能漂移。
9. **中高：缺少查询复合索引。** 文章、评论和认证的主查询在大数据量下会扫描和排序大量记录。
10. **已解决主要缺口：联络频率计数已写数据库。** 同一 IP 每小时最多 5 次，重启和多实例共享；垃圾累计封禁仍保留进程内快速状态与数据库封禁标记，正式高流量方案仍需网关/Redis 和监控。

## 2026-08-13 首发执行状态

- `/api/articles`、`/api/feed`、文章评论/点赞/收藏以及用户关注相关路径，在 `COMMUNITY_ENABLED=false` 时统一返回 `404 + FEATURE_NOT_AVAILABLE`。
- 联名作品公开展示 `/api/collab/works*` 继续开放，但联名点赞接口随社区关闭；列表和详情在关闭时不再查询点赞表。
- `/api/certify*` 在 `MOCK_CERTIFICATION_ENABLED=false` 时关闭，避免当前客户端模拟结果被误作真实认证。
- 六类联络继续允许匿名提交，`POST /api/contact` 在参数校验前消耗 IP 小时额度，因此恶意无效请求也不能无限尝试。
- “匿名联络验证码”尚未实现；当前完成的是频率限制、反垃圾、附件归属和员工读取权限。公网开放前必须接入服务端可验证的人机挑战。
11. **中：后台分页参数无统一上限。** 联络和用户后台可请求过大 limit，放大数据库和响应负载。
12. **中：列表 JSON 解析脆弱。** 一条损坏的联络 `extra/attachments` 即可让整页列表报错。

### 业务闭环

13. **高：认证没有运营入口。** 无申请列表/详情页，也没有审核日志、审核人字段、复核机制。
14. **中高：角色与认证身份不一致。** 认证只改 `certifyStatus`，通知却要求 `role >= 1`。
15. **中：互动通知未实现。** 用户设置里的互动/系统/营销开关没有对应通知事件和读取入口。
16. **已解决：联络身份不可由客户端声明。** 公开接口忽略客户端身份，只依据可选的已验证会话绑定用户；匿名提交保持 `submitterUserId = null`。
17. **中：手动封 IP 不会即时进入公开路由的内存集合。** 后台只改数据库，通常要重启服务才会由启动加载逻辑生效。
18. **中：PII 生命周期未定义。** 实名后四位、简历、联系方式、IP 和 User-Agent 没有保存期限、删除/归档和访问审计策略。

## 已确认的联络产品规则

1. 首发保留画师/IP、线下渠道、媒体/博主、加入团队、反馈、厂家六类联络入口，六类均允许未登录提交。
2. 匿名提交需要验证码、可跨实例生效的限流和反垃圾处理；已登录提交由后端根据已验证会话自动绑定账号。客户端传入的 `submitterUserId` 不能作为身份依据。
3. 只有画师/IP 作品集和求职简历开放附件：作品集接受 JPG、PNG、PDF，单文件最大 20MB；简历只接受 PDF，单文件最大 10MB。首发拒绝 Word、ZIP、PSD、AI 及所有可执行文件。
4. 线下渠道、媒体、反馈和厂家首发使用结构化文字及受控外部链接，不直接接收附件。外部链接仍需限制协议、长度和允许的跳转行为。
5. 合同附件不经过公开联络表单，只允许授权员工在后台上传 PDF 或图片，并按合同权限、版本和审计规则保存。
6. 未建立合作且不再跟进的作品集、简历和联络附件，在最后一次有效联系后 6 个月自动删除；表单中的个人信息按需要匿名化或删除。正式合作、录用、投诉/争议或法定义务相关材料转入对应的合同、人事或争议记录，执行独立留存规则。
7. 上传接口必须使用服务端签发的用途限定上传会话，校验所有者、目录、扩展名、真实文件类型、大小、对象存在性和扫描状态；管理员只能读取已绑定到对应提交记录的附件。

## 已确认的首发内容、认证与通知边界

1. 首发在服务端关闭文章发布与读取、混合 feed、评论、点赞、收藏和关注；页面入口同步关闭，代码保留。经平台审核的联名商品展示属于商城展示，不视为社区内容，继续开放。
2. 文章由谁发布、如何审核和申诉，以及 `public/followers/private` 的字段级可见性，不在首发中仓促定案；社区重新启用前必须完成规则、内容治理和服务端权限矩阵。
3. 当前模拟实名页面和客户端 `certifyPassed` 布尔值不得作为身份凭证。普通定制中的创作者声明只形成合作线索，由企业微信人工核实版权和持续原创能力；正式联名签约、产生分红或提现前必须接入可靠实名核验。
4. 首发通知事件限于人工筛帧处理结果、联名审核结果、付款结果、订单状态、发货、售后和账号安全。站内/小程序通知保存可查询记录；微信订阅消息须由用户主动授权；短信仅用于验证码和重要安全/订单异常；商务联络使用邮箱或企业微信。
5. 社区互动通知随社区重新启用再设计，营销消息不得混入交易通知，未来发送前必须取得单独同意并支持退订。

## 改造复杂度评估

| 事项 | 复杂度 | 原因 |
|---|---|---|
| 修正关注响应、认证时效文案、断链、公开状态过滤、输入上限 | 低 | 局部契约或查询修改，但需要补回归测试 |
| 为文章/评论/认证补复合索引，限制后台分页 | 低至中 | 需新增迁移并在模拟数据上验证查询计划 |
| 隐私可见性统一服务、计数校准和并发幂等互动 | 中 | 多个公开查询与写入口要共用规则 |
| 文章审核、举报、评论治理和运营后台 | 中至高 | 需要状态机、权限、审计、通知和页面闭环 |
| 真实认证与私有材料管理 | 高 | 涉及第三方实名、回调验签、加密、文件扫描、最小授权和留存合规 |
| 企业级 feed 和浏览/互动计数 | 高 | 需要游标分页、数据库/缓存策略、异步计数、热点治理和容量测试 |
| 完整用户通知中心 | 高 | 需要事件模型、偏好、去重、投递渠道、已读状态和批量扇出策略 |

## 建议实施顺序

1. 在社群正式启用前，先明确首发边界并消除现行断链；未启用的公开写接口应有服务端功能开关。
2. 封住文章状态/隐私和联络附件授权，建立统一输出转义与 URL 白名单。
3. 完成真实认证的提交、审核列表、审核日志和身份模型统一。
4. 把 feed 改为数据库级有界查询和稳定游标分页，再设计浏览/互动计数策略。
5. 补文章/评论治理、举报申诉和通知事件。
6. 最后以压测、数据校准、故障注入和多实例验证确认容量，不以页面能打开作为上线标准。

## 待确认事项

产品决策集中在 `docs/OPEN_QUESTIONS.md` 的 Q-026 至 Q-032。首发社区开关、联络登录、联络附件、作品集/简历留存和首发通知范围已经确认；文章发布/隐私细则延后到社区启用前，实名供应商、认证凭证及其他个人资料期限仍待确认。

## 调查覆盖率

- 已读：`articles.js`、`feed.js`、`users.js`、`certify.js`、`contact.js`、`admin-contact.js`、`notifications.js`、`admin.js` 用户段、`products.js` 公开列表段。
- 已读：相关 Prisma 模型、初始社区迁移、联络迁移和后续 `submitter_user_id` 迁移。
- 已检索：全部 Web HTML/JS 对上述 API 的消费者；现行与 `_legacy` 页面已区分。
- 已对照：`API.md`、`DATABASE.md`、`FRONTEND.md`、`CLAUDE.md`、`test.http`。
- 未做：启动服务、连接数据库、真实 OSS 上传、性能压测和浏览器逐页视觉验收；这些分别留给运维质量和 Web 批次。

## 相关文档

- `docs/modules/foundation-auth-security.md`
- `docs/modules/collab-creator-revenue.md`
- `docs/DOC_CODE_DIFFERENCES.md`
- `docs/OPEN_QUESTIONS.md`
- `docs/ACCOUNT_DELETION_POLICY.md`
- `docs/FRONTEND.md`
- `docs/API.md`
