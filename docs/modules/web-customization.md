# Web 定制作品流程

> 首版实施日期：2026-08-20。本文件记录当前代码已经实现的事实、已确认业务规则和下一批边界。定制申请不是订单，也不是生产任务。

## 简单说明

用户先选标准潮玩款式，再从两种方式中选择一种：自己在网页筛帧，或上传原素材请工作人员异步筛选。正式提交后系统生成独立定制编号，用户在“我的定制”查看进度，工作人员在后台查看申请与私有素材。

当前已完成“提交、员工人工筛帧、用户播放确认、选择标准 SKU”的闭环。用户要求重新筛帧也会回到员工队列并形成新版本。锁定最终价格、确认可制作性、生成待支付订单仍是下一批，尚不能视为完整交易上线。

## 三类编号必须分开

| 对象 | 当前标识 | 何时产生 | 用途 |
|---|---|---|---|
| 云端草稿 | 数据库内部 UUID；无公开编号 | 自己筛选结果保存时 | 用户暂存，不能作为客服凭证 |
| 定制申请 | `DZ-YYYYMMDD-XXXXXX` | 用户正式提交时 | 用户与工作人员沟通、查看审核进度 |
| 订单/生产 | 现有订单号、批次号体系 | 审核后生成订单/进入生产时 | 交易、库存、生产和售后；本批未改 |

编号尾码使用排除 `0/O/1/I` 的安全随机字符。数据库对定制编号和浏览器草稿键均设唯一约束；生成时最多重试八次。

## 两条用户流程

上传选择页采用桌面端一屏双入口布局：顶部步骤栏提供“返回选型号”，页面不重复常驻审核说明。自己筛选在最终确认页说明需提交制作审核；人工筛选在实际提交前再次确认会进入人工筛选和制作可行性审核。

### 自己筛选

1. 用户可以先在浏览器预览、裁剪、抽帧，无需登录。
2. 点击下一步时必须登录。
3. 选中帧上传为 `CUSTOMIZATION_FRAME`，原始素材上传为 `CUSTOMIZATION_SOURCE`。
4. `CustomProduct` 保存可继续编辑的帧草稿；`CustomizationRequest` 保存定制业务草稿，此时状态为 `DRAFT`，不生成 `DZ` 编号，也不进入员工队列。
5. 上传页跳转到选款式页时，通过网址携带款式、帧数、可用帧数和云端草稿 ID；选款式页优先使用这些本次流程参数，避免被浏览器旧缓存干扰。
6. 用户选定标准 SKU 并提交制作审核后，状态变为 `SUBMITTED`，此时才生成 `DZ` 编号。

### 请工作人员筛选

1. 用户一次选择一个视频/GIF，或 1 至 50 张图片；网页限制本次合计不超过 200 MB。
2. 网页检查格式、数量、总大小和首个素材比例；正常素材不显示无实际作用的“检查完成”文案，仅在比例可能不适合时给出提示。
3. 提交前必须登录；原素材上传后直接创建 `HUMAN + SUBMITTED` 定制申请并生成 `DZ` 编号。
4. 页面明确提示这是异步处理，工作人员稍后在“我的定制”返回结果。
5. 页面通过选型号记录和网址参数双重恢复款式编号，避免浏览器旧记录字段不同导致误报“没有选择款式”。
6. 负责人或生产人员从后台领取任务，在现有帧编辑器中完成裁剪、抽帧、去重、排序和播放预览。
7. 工作人员提交的筛帧结果形成只追加、不覆盖的版本，用户在“我的定制”进入同一编辑器的只读确认模式。
8. 用户可以选择“需要调整”并说明原因，任务重新排入队列；也可以点击“满意，选择款式”，再选择标准 SKU。
9. 选完 SKU 后状态停在 `STYLE_SELECTED`，等待后续人工确认制作可行性和最终固定价格；此时不能进入购物车。

## 创作者与版权

- 人工筛选上传区不再重复要求用户勾选创作者、版权和联名合作选项。
- 已确认方向：版权提示以后放在用户从创作中心进入定制流程时统一展示；该入口提示尚未在本批实现，上线前必须补齐并确认具体文案。
- 数据库暂时保留创作者、版权和合作意向字段，便于后续入口提示确定后继续使用；当前人工筛选页面不写入这些意向。
- 初期优惠和合作仍由企业微信人工核验；标准优惠形式尚未定案。

## 状态

| 状态 | 用户含义 | 当前是否可由界面产生 |
|---|---|---|
| `DRAFT` | 未正式提交的云端草稿 | 是 |
| `EXPIRING` | 定时任务正在清理过期草稿的内部短暂状态 | 自动产生；不进入员工队列 |
| `SUBMITTED` | 已提交，等待处理 | 是 |
| `REVIEWING` | 工作人员已领取并正在筛帧 | 是 |
| `NEEDS_SUPPLEMENT` | 需要用户补充素材 | 预留 |
| `OPTIONS_READY` | 工作人员已提交筛帧，等待用户播放确认 | 是 |
| `FRAME_ACCEPTED` | 用户已确认筛帧，等待选择款式 | 是 |
| `STYLE_SELECTED` | 用户已选择标准 SKU，等待最终制作与价格确认 | 是 |
| `UNAVAILABLE` | 当前素材暂时无法制作 | 预留 |
| `CONFIRMED` | 用户已确认最终方案 | 预留；只有该状态未来可进入购物车 |
| `CLOSED` | 已结束或草稿过期 | 7 天草稿清理会产生 |

每次状态变化写入 `customization_request_events` 追加式时间线，不覆盖旧事件。员工内部说明与用户可见说明分字段保存，后续补素材、价格和订单阶段也必须继续遵守这一规则。

### 人工筛帧任务锁与版本

- 只有负责人 `OWNER` 和生产人员 `PRODUCTION` 可以领取、编辑和提交筛帧；客服 `CUSTOMER_SERVICE` 只能查看。
- 同一任务同一时间只允许一名员工编辑。领取后锁定 10 分钟，编辑器每 4 分钟续期；超过锁定时间且员工不再续期时，其他有权限员工可以重新领取。
- 编辑器每 15 秒保存一次已选帧序号、裁剪区间等草稿；草稿仅用于员工继续工作，不会展示给用户。
- 正式提交写入 `CustomizationFrameSelection`。每次重新提交版本号加一，旧版本保留为 `REVISION_REQUESTED`、`REPLACED` 或 `ACCEPTED`，不可被覆盖。
- “提交并下一条”会按最早提交优先领取下一项等待任务；“退回任务池”会释放当前任务给其他员工。
- 对用户公开的说明保存为 `staffMessage/publicMessage`；员工内部交接备注保存为 `internalNote`，用户接口不返回内部备注。

## 素材保存与清理

- 保存原始上传素材、用户最终选中的完整帧、低成本预览信息和编辑配方；不永久保存浏览器抽出的每一张完整帧。
- 图片组和视频产生的完整帧不得写入 `localStorage`。浏览器只缓存私有文件 key、款式信息和草稿 ID；即使本地缓存已满，云端草稿保存和进入选款式页也不能中断。
- 上传完成但未绑定任何业务记录的定制素材，24 小时后自动删除。
- `DRAFT` 超过 7 天未提交时转为 `CLOSED`，删除实际原素材、选中帧和无购物车关联的 `CustomProduct`，保留“草稿已过期”的时间线解释。
- 清理任务先原子地把草稿标为 `EXPIRING`，与用户正式提交互斥；无论哪一方先完成，都不会留下“申请已提交但素材被删”的混合状态。
- 正式处理中定制会阻止账号注销；未提交/已关闭记录可在注销时清除个人说明和实际素材。
- 工作人员提交的帧最初归上传员工所有；正式提交事务会把所有权转给申请用户，并绑定到具体筛帧版本。提交失败时不会发生半数转移。
- 用户确认页使用 30 分钟临时读取地址；员工读取原素材仍使用五分钟临时地址，载入编辑器后在浏览器本地处理。
- 本地文件位于 `content-service/storage/private/`；正式环境必须使用私有 OSS。

## 权限

- 普通用户只能列出和查看自己的定制记录。
- 运营客服、生产人员和负责人可接收定制队列及查看已绑定素材；只有生产人员和负责人可以编辑。
- 合作运营和普通用户访问后台定制接口会返回 403。
- 后台仅展示手机号后四位；查看每个私有素材都会写安全记录，签名链接有效五分钟。
- 草稿不进入员工队列，未绑定素材对任何员工都不可见。
- 客户端隐藏按钮不构成权限；所有限制都由后端再次检查。

## 页面与代码

| 层 | 文件 | 作用 |
|---|---|---|
| Web | `frontend/pages/customize-start.html` | 选择机型 |
| Web | `frontend/pages/customize-editor.html` | 双入口、浏览器筛帧、原素材提交 |
| Web | `frontend/pages/customize-confirm.html` | 自己筛选后选 SKU 并正式提交审核 |
| Web | `frontend/pages/my-customizations.html` | 用户定制列表、状态筛选和时间线 |
| Web | `frontend/pages/admin-customization-requests.html` | 员工接收列表、详情和素材查看 |
| 公共脚本 | `frontend/js/private-upload.js` | 私有文件上传；支持原 File/Blob 与帧图 |
| 公共脚本 | `frontend/js/customization-review-editor.js` | 后台筛帧模式、任务锁续期、用户只读确认和流转 |
| 公共脚本 | `frontend/js/admin-customization-workbench.js` | 后台领取、岗位按钮、处理人和快速下一条 |
| 公共脚本 | `frontend/js/auth.js` | 账号下拉菜单增加“我的定制” |
| 后端 | `src/routes/customization-requests.js` | 用户草稿、提交、列表和详情 |
| 后端 | `src/routes/admin-customization-requests.js` | 员工队列、统计、详情和临时素材地址 |
| 后端 | `src/lib/customization-request.js` | 编号、素材 key 和状态工具 |
| 后端 | `src/lib/private-file-cleanup.js` | 中断上传和 7 天草稿清理 |
| 数据库 | `CustomizationRequest`、`CustomizationRequestEvent`、`CustomizationFrameSelection` | 申请主记录、时间线和不可覆盖的筛帧版本 |

迁移文件：`prisma/migrations/20260820140000_add_customization_requests/migration.sql`、`prisma/migrations/20260820210000_add_staff_frame_selection/migration.sql`。

## API

| 方法 | 路径 | 权限 | 当前作用 |
|---|---|---|---|
| POST | `/api/customization-requests/draft` | 登录用户 | 保存自己筛选的无编号草稿 |
| POST | `/api/customization-requests` | 登录用户 | 提交人工筛选申请 |
| POST | `/api/customization-requests/:id/submit` | 草稿本人 | 正式提交自己筛选草稿并编号 |
| GET | `/api/customization-requests/mine` | 登录用户 | 查询自己的定制记录 |
| GET | `/api/customization-requests/mine/:id` | 记录本人 | 查询自己的详情与时间线 |
| GET | `/api/customization-requests/mine/:id/frame-selection` | 记录本人 | 读取最新有效筛帧版本和临时帧地址 |
| POST | `/api/customization-requests/mine/:id/frame-selection/accept` | 记录本人 | 确认工作人员筛帧 |
| POST | `/api/customization-requests/mine/:id/frame-selection/revision` | 记录本人 | 提出调整意见并重新进入队列 |
| POST | `/api/customization-requests/mine/:id/choose-sku` | 记录本人 | 筛帧确认后选择标准 SKU |
| GET | `/api/admin/customization-requests` | 定制审核岗位 | 非草稿队列 |
| GET | `/api/admin/customization-requests/stats` | 定制审核岗位 | 状态数量 |
| GET | `/api/admin/customization-requests/:id` | 定制审核岗位 | 脱敏详情与五分钟素材链接 |
| POST | `/api/admin/customization-requests/claim-next` | 负责人/生产 | 领取最早等待或锁已过期的任务 |
| POST | `/api/admin/customization-requests/:id/claim` | 负责人/生产 | 领取指定任务 |
| POST | `/api/admin/customization-requests/:id/heartbeat` | 当前处理人 | 延长 10 分钟编辑锁 |
| PUT | `/api/admin/customization-requests/:id/frame-draft` | 当前处理人 | 保存员工筛帧草稿 |
| POST | `/api/admin/customization-requests/:id/release` | 当前处理人/负责人 | 退回任务池 |
| POST | `/api/admin/customization-requests/:id/frame-selections` | 当前处理人 | 提交新版本，可同时领取下一条 |

## 当前明确未完成

1. 后台判定不可制作、请求用户补充/替换原素材，以及推荐其他动画或其他适配款式。
2. 最终制作可行性确认、价格快照、不可随意修改的最终确认记录，以及从 `CONFIRMED` 生成待支付订单。
3. 通知中心提醒、员工超时提醒、任务 SLA 和批量分配。
4. 恶意文件扫描、正式 OSS、备份恢复和大文件异步处理。
5. 当前旧 `/api/cart/add` 已拒绝未到 `CONFIRMED` 的定制草稿；`FRAME_ACCEPTED` 和 `STYLE_SELECTED` 也不能绕过最终审核直接购买。

人工筛选提交使用浏览器随机提交键，自己筛选使用草稿 ID；网络重试会返回原申请和原编号，不会重复建单。

## 自动验证

运行 `npm run check:customization-flow`。接口测试会临时创建账号、机型、SKU 和私有素材，验证两种提交方式、任务锁、岗位权限、两版筛帧、文件所有权转移、用户调整/确认、选款式、注销阻断、购物车门槛和自动清理，结束后删除测试数据。

运行 `npm run check:customization-ui`。真实 Edge 浏览器会验证后台领取与提交、用户播放确认并进入选款式页、自己筛选在浏览器存储已满时仍能携带云端草稿 ID 进入选款式页，以及移动端列表无横向溢出；同样会自动清除临时数据。

人工验收步骤见 `docs/WEB_CUSTOMIZATION_ACCEPTANCE.md`。
