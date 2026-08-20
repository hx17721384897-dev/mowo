# Web 定制作品流程

> 首版实施日期：2026-08-20。本文件记录当前代码已经实现的事实、已确认业务规则和下一批边界。定制申请不是订单，也不是生产任务。

## 简单说明

用户先选标准潮玩款式，再从两种方式中选择一种：自己在网页筛帧，或上传原素材请工作人员异步筛选。正式提交后系统生成独立定制编号，用户在“我的定制”查看进度，工作人员在后台查看申请与私有素材。

当前完成的是“提交和接收”闭环。工作人员给方案、用户补素材/确认方案、锁定最终价格、生成待支付订单仍是下一批，尚不能视为已上线。

## 三类编号必须分开

| 对象 | 当前标识 | 何时产生 | 用途 |
|---|---|---|---|
| 云端草稿 | 数据库内部 UUID；无公开编号 | 自己筛选结果保存时 | 用户暂存，不能作为客服凭证 |
| 定制申请 | `DZ-YYYYMMDD-XXXXXX` | 用户正式提交时 | 用户与工作人员沟通、查看审核进度 |
| 订单/生产 | 现有订单号、批次号体系 | 审核后生成订单/进入生产时 | 交易、库存、生产和售后；本批未改 |

编号尾码使用排除 `0/O/1/I` 的安全随机字符。数据库对定制编号和浏览器草稿键均设唯一约束；生成时最多重试八次。

## 两条用户流程

### 自己筛选

1. 用户可以先在浏览器预览、裁剪、抽帧，无需登录。
2. 点击下一步时必须登录。
3. 选中帧上传为 `CUSTOMIZATION_FRAME`，原始素材上传为 `CUSTOMIZATION_SOURCE`。
4. `CustomProduct` 保存可继续编辑的帧草稿；`CustomizationRequest` 保存定制业务草稿，此时状态为 `DRAFT`，不生成 `DZ` 编号，也不进入员工队列。
5. 用户选定标准 SKU 并提交制作审核后，状态变为 `SUBMITTED`，此时才生成 `DZ` 编号。

### 请工作人员筛选

1. 用户一次选择一个视频/GIF，或 1 至 50 张图片；网页限制本次合计不超过 200 MB。
2. 网页只做格式、数量、总大小和首个素材比例等基础提示，不承诺工艺可制作。
3. 提交前必须登录；原素材上传后直接创建 `HUMAN + SUBMITTED` 定制申请并生成 `DZ` 编号。
4. 页面明确提示这是异步处理，工作人员稍后在“我的定制”返回结果。

## 创作者与版权

- 用户可以声明自己是创作者或版权方；勾选后必须同时确认有权提交该素材。
- 是否愿意了解联名合作为可选项，不强迫添加企业微信。
- 当前声明只记录意向，不自动授予创作者优惠、认证或分红资格。
- 初期优惠和合作仍由企业微信人工核验；标准优惠形式尚未定案。

## 状态

| 状态 | 用户含义 | 当前是否可由界面产生 |
|---|---|---|
| `DRAFT` | 未正式提交的云端草稿 | 是 |
| `EXPIRING` | 定时任务正在清理过期草稿的内部短暂状态 | 自动产生；不进入员工队列 |
| `SUBMITTED` | 已提交，等待处理 | 是 |
| `REVIEWING` | 工作人员处理中 | 预留，后台操作未实现 |
| `NEEDS_SUPPLEMENT` | 需要用户补充素材 | 预留 |
| `OPTIONS_READY` | 有可选制作方案待用户确认 | 预留 |
| `UNAVAILABLE` | 当前素材暂时无法制作 | 预留 |
| `CONFIRMED` | 用户已确认最终方案 | 预留；只有该状态未来可进入购物车 |
| `CLOSED` | 已结束或草稿过期 | 7 天草稿清理会产生 |

每次状态变化写入 `customization_request_events` 追加式时间线，不覆盖旧事件。员工内部说明与用户可见说明必须分字段保存；下一批实现状态操作时继续遵守这一规则。

## 素材保存与清理

- 保存原始上传素材、用户最终选中的完整帧、低成本预览信息和编辑配方；不永久保存浏览器抽出的每一张完整帧。
- 上传完成但未绑定任何业务记录的定制素材，24 小时后自动删除。
- `DRAFT` 超过 7 天未提交时转为 `CLOSED`，删除实际原素材、选中帧和无购物车关联的 `CustomProduct`，保留“草稿已过期”的时间线解释。
- 清理任务先原子地把草稿标为 `EXPIRING`，与用户正式提交互斥；无论哪一方先完成，都不会留下“申请已提交但素材被删”的混合状态。
- 正式处理中定制会阻止账号注销；未提交/已关闭记录可在注销时清除个人说明和实际素材。
- 本地文件位于 `content-service/storage/private/`；正式环境必须使用私有 OSS。

## 权限

- 普通用户只能列出和查看自己的定制记录。
- 运营客服、生产人员和负责人可接收定制队列及查看已绑定素材。
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
| 公共脚本 | `frontend/js/auth.js` | 账号下拉菜单增加“我的定制” |
| 后端 | `src/routes/customization-requests.js` | 用户草稿、提交、列表和详情 |
| 后端 | `src/routes/admin-customization-requests.js` | 员工队列、统计、详情和临时素材地址 |
| 后端 | `src/lib/customization-request.js` | 编号、素材 key 和状态工具 |
| 后端 | `src/lib/private-file-cleanup.js` | 中断上传和 7 天草稿清理 |
| 数据库 | `CustomizationRequest`、`CustomizationRequestEvent` | 申请主记录和时间线 |

迁移文件：`prisma/migrations/20260820140000_add_customization_requests/migration.sql`。

## API

| 方法 | 路径 | 权限 | 当前作用 |
|---|---|---|---|
| POST | `/api/customization-requests/draft` | 登录用户 | 保存自己筛选的无编号草稿 |
| POST | `/api/customization-requests` | 登录用户 | 提交人工筛选申请 |
| POST | `/api/customization-requests/:id/submit` | 草稿本人 | 正式提交自己筛选草稿并编号 |
| GET | `/api/customization-requests/mine` | 登录用户 | 查询自己的定制记录 |
| GET | `/api/customization-requests/mine/:id` | 记录本人 | 查询自己的详情与时间线 |
| GET | `/api/admin/customization-requests` | 定制审核岗位 | 非草稿队列 |
| GET | `/api/admin/customization-requests/stats` | 定制审核岗位 | 状态数量 |
| GET | `/api/admin/customization-requests/:id` | 定制审核岗位 | 脱敏详情与五分钟素材链接 |

## 当前明确未完成

1. 后台变更审核状态、填写面向用户的说明、推荐款式和请求补素材。
2. 用户补充/替换素材、比较并确认工作人员方案。
3. 最终价格快照、不可随意修改的确认记录和从 `CONFIRMED` 生成待支付订单。
4. 通知中心提醒、超时提醒和工单 SLA。
5. 恶意文件扫描、正式 OSS、备份恢复和大文件异步处理。
6. 当前旧 `/api/cart/add` 已拒绝未到 `CONFIRMED` 的定制草稿，不能绕过审核直接购买。

人工筛选提交使用浏览器随机提交键，自己筛选使用草稿 ID；网络重试会返回原申请和原编号，不会重复建单。

## 自动验证

运行 `npm run check:customization-flow`。测试会临时创建账号、机型、SKU 和私有素材，验证两种提交方式、编号、所有权、岗位权限、签名读取、注销阻断、购物车门槛和两类自动清理，结束后删除测试数据。

人工验收步骤见 `docs/WEB_CUSTOMIZATION_ACCEPTANCE.md`。
