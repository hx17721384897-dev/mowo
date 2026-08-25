# 管理后台、生产批次与外部订单导入

> 调查基准：2026-08-12；实现更新：2026-08-23。本文保留最初调查事实，并在对应位置追加后续实现状态，不把 `PRODUCTION.md` 中的规划自动视为已实现。

> 目标流程更新：2026-08-23 已确认材料包款生产批次和并行作业规则，见 `../PRODUCTION_BATCH_WORKFLOW.md`。本文继续作为旧代码调查记录；两者冲突时，代码事实以本文为准，后续业务目标以新流程文档为准。

## 调查范围与完成度

本轮已交叉核对：

- 后端入口：`content-service/src/index.js`
- 管理与生产：`routes/admin.js`、`routes/inventory.js`
- 外部订单：`routes/import.js`、`routes/platform-sku.js`
- 库存领域方法：`lib/inventory.js`
- 进程内任务：`lib/scheduler.js`、`lib/bull-scheduler.js`
- 数据结构与历史迁移：`prisma/schema.prisma`、`prisma/migrations/**/migration.sql`
- 前端消费者：`admin-orders.html`、`admin-import.html`、`admin-inventory.html`、`production-scan.html`、`production-inventory.html`、`_legacy/admin-production.html`
- 现有说明：`PRODUCTION.md`、`docs/API.md`、`docs/DATABASE.md`、`docs/FRONTEND.md`、`CLAUDE.md`

结论：项目并非没有生产追踪设计。订单编号、批次、生产状态、地址导出、物流录入、帧包导出、生产扫码、外部订单导入和库存页面均已有代码；本文的任务是还原它们现在如何连接，并指出实现、原规划与最终业务意图之间尚未收口的部分。目前还不能把这些路径视为一条满足企业级一致性要求的完整闭环，主要问题集中在权限遗漏、多个状态入口各自写库、批次副作用发生在文件响应之后、扫码确认只存在浏览器内存、幂等键不稳定、Schema 与迁移不一致，以及大列表/文件处理缺少有界队列。

> **解释边界：**本文描述“未闭环”或“待确认”时，不代表订单编号、批次、状态或追踪功能不存在，而是表示代码中的多个实现尚缺少一份由项目负责人确认的统一业务说明。生产和库存细节较复杂，当前不依据审计建议改写业务规则；待实际修改该模块前，先由项目负责人补充完整生产流程，再更新本文的目标设计。

## 模块职责与技术实现

| 范围 | 当前实现 | 主要技术 |
|---|---|---|
| 管理订单 | 查询、状态更新、地址导出、物流录入、帧包导出、售后处理 | Fastify、Prisma、PostgreSQL |
| 文件生产 | 从 OSS 拉取原帧，生成条码和 DOCX，再流式返回 ZIP | Ali OSS、`archiver`、`bwip-js`、`adm-zip`、DOCX 模板 |
| 批次看板 | `CustomizeOrder.batchId` 聚合；另有 `ProductionBatch`、`BatchItem` | Prisma + Node.js 内存分组 |
| 生产扫码 | SKU、订单、快递单查询；前端逐单确认后整单发货 | 原生 HTML/JS、JWT、Fastify |
| 外部导入 | 淘宝 CSV、手工订单、待处理映射、规格映射 | multipart、手写 CSV 解析器、Prisma |
| 库存 | 预锁、在制、核销、盘点、快照、渠道配额 | 原生 SQL + Prisma 事务 |
| 定时任务 | 冷却期、储备金、快照、授权、预订单、草稿、自动收货、牛量 | API 进程中的 `setTimeout` / `setInterval` |

`admin.js` 静态导入 `docx`，并动态导入 `adm-zip`，但二者不在 `content-service/package.json` 或其 lockfile 中。当前机器可从仓库上层的 `node_modules` 解析，独立安装或容器只安装 `content-service` 时不能保证启动成功。静态导入的多个 `docx` 类目前也没有实际使用；真正的模板填充采用 `adm-zip` 修改 DOCX XML。

## 文件与依赖关系

```text
index.js
├─ /api/admin             -> routes/admin.js
│  ├─ Prisma              -> CustomizeOrder / ProductionBatch / BatchItem / FrameInstance
│  ├─ OSS                 -> 原帧下载和签名 URL
│  ├─ inventory.js        -> startWipFrame()
│  └─ templates/*.docx    -> barcode_template.docx / checklist_template.docx
├─ /api/admin/import      -> routes/import.js
│  ├─ PlatformSkuMapping
│  ├─ CustomizeOrder
│  └─ inventory.js        -> ensureInventoryRecord() / lockInventory()
├─ /api/admin/sku-mapping -> routes/platform-sku.js
├─ /api/inventory         -> routes/inventory.js -> inventory.js
└─ listen 后直接启动      -> scheduler.js + bull-scheduler.js
```

`admin-orders.html` 是当前管理员生产主界面；`_legacy/admin-production.html` 仍调用 `/api/admin/production/*` 和单订单 ZIP 下载，但页面已放入旧版目录。`production-scan.html` 是 role 1 生产人员的扫码页。`production-inventory.html` 虽然有完整界面，但与后端权限和请求字段不匹配，不能视为可用闭环。

## API 与权限

### 管理订单与批次

| 路由 | 权限 | 当前作用 | 关键说明 |
|---|---:|---|---|
| `GET /api/admin/stats` | role >= 2 | 各订单状态计数 | 9 次独立 count |
| `GET /api/admin/orders` | role >= 2 | 分页查询订单 | page/limit 无上限；缺高频筛选索引 |
| `GET /api/admin/orders/:orderNo` | role >= 1 | 订单详情与原帧签名 URL | 生产角色可读完整收件信息和全部帧 |
| `GET /api/admin/orders/:orderNo/download-zip` | role >= 1 | 单订单生产包 | 下载后直接改 producing；不校验来源状态 |
| `PUT /api/admin/orders/:orderNo/status` | role >= 2 | 单订单改状态 | 允许任意合法状态互转，无状态迁移矩阵 |
| `PUT /api/admin/orders/batch-status` | role >= 2 | 批量改状态 | received 不执行单笔收货的分红/储备金逻辑 |
| `PUT /api/admin/orders/:orderNo/tracking` | role >= 2 | 物流录入并改 processing | 不校验原状态 |
| `POST /api/admin/orders/export-address` | role >= 2 | 生成地址数据，订单改 locked 并写 batchId | 选择、编号、更新、批次记录不在同一事务 |
| `POST /api/admin/orders/import-tracking` | role >= 2 | 批量录物流并改 processing | 逐条执行，失败时部分成功 |
| `GET /api/admin/batches/preview` | role >= 2 | 预览未分批 paid 订单 | 一次读入全部记录 |
| `POST /api/admin/batches` | role >= 2 | 创建旧 `ShippingBatch` | 注释称已废弃，但路由仍可调用 |
| `POST /api/admin/orders/batch-export-frames` | role >= 2 | 流式导出帧包并推进生产副作用 | 允许混合 batchId；副作用发生在 ZIP 响应之后 |
| `GET /api/admin/batches` | role >= 2 | 按订单 batchId 内存聚合 | 读取全部已分批订单，无分页 |
| `GET /api/admin/batches/:batchId/stats` | role >= 2 | 批次状态统计 | 基于订单状态 |

### 扫码、生产进度与正版码

| 路由 | 权限 | 当前作用 | 实际闭环 |
|---|---:|---|---|
| `GET /api/admin/scan/sku/:barcode` | role >= 1 | 查 SKU | 查询可用 |
| `GET /api/admin/scan/order/:orderNo` | role >= 1 | 查订单及同快递单订单 | 返回收件 PII；“完成”按 producing/shipped 判断 |
| `GET /api/admin/scan/tracking/:trackingNo` | role >= 1 | 查面单下订单 | 无持久扫描会话 |
| `POST /api/admin/scan/confirm-order` | role >= 1 | 校验订单属于面单 | 只返回结果，不写 `OrderItemBinding` |
| `POST /api/admin/scan/ship-tracking` | role >= 1 | 将面单下订单改 shipped | 信任客户端传来的订单号数组；可覆盖不合理原状态 |
| `GET /api/admin/batches/:batchId/progress` | role >= 1 | 查批次 SKU 进度 | 依赖 `BatchItem` |
| `POST .../defect` / `POST .../complete` | role >= 1 | 数量加一 | 无上限、幂等键、扫码证据和独立审计 |
| `GET /api/admin/auth-codes/*` | role >= 2 | 查/导出正版码 | 码值直接返回给后台 |
| `POST /api/admin/auth-codes/generate/:orderId` | role >= 2 | 手工生成正版码 | `Math.random()`；orderId 无唯一约束，并发可重复 |
| `GET /api/inventory/verify/:code` | 公开 | 验证正版码并累计次数 | 本轮未见接口级限流 |

系统还有另一条 `POST /api/inventory/ship` 发货路径，会核销库存、生成正版码并改订单状态；而扫码页调用的是 `/api/admin/scan/ship-tracking`，后者不核销库存、不生成正版码，也不创建 `OrderItemBinding`。因此“发货”目前不是单一领域动作。

### 外部导入与库存页面

- `/api/admin/import/taobao|manual|pending|:orderId/resolve` 和 `/api/admin/sku-mapping/*` 均要求 role >= 2。
- 淘宝上传把整个文件缓存在内存后按 UTF-8 解析；手写解析器不支持引号字段内换行，未处理常见平台导出的其他编码。
- 映射使用文本包含查询和 `findFirst`，没有唯一、优先级或版本规则；相似描述可能命中不确定记录。
- `production-inventory.html` 允许 role >= 1，但首次加载的库存列表和日志接口要求 role >= 2；页面入库发送 `{ qty }`，后端要求 `{ quantity }`；页面还调用不存在的 `POST /api/inventory/:skuId/adjust`。普通生产账号无法按页面设计完成流程。

## 数据模型与迁移状态

| 模型 | 用途 | 当前消费者与约束 |
|---|---|---|
| `CustomizeOrder` | 生产履约主记录 | 有平台订单联合唯一；缺 status/batchId/trackingNo/shippedAt 等查询索引 |
| `ShippingBatch` | 旧按收件人批次 | 路由仍能创建；文档称已弃用 |
| `ProductionBatch` | 新生产批次主表 | 地址/帧包导出 upsert；Schema 有、迁移缺失 |
| `BatchItem` | 批次 SKU 计划/实产/报废 | 重复导出会继续 increment plannedQty；Schema 有、迁移缺失 |
| `FrameInstance` | 订单帧实例与内容哈希 | orderId 仅普通索引；代码用确定性 id upsert；Schema 有、迁移缺失 |
| `OrderItemBinding` | 订单码、SKU 码、面单、批次配对 | Schema 有，当前源码未发现写入者；迁移缺失 |
| `AuthCode` | 正版码 | code 唯一，orderId 不唯一 |
| `PlatformSkuMapping` | 外部描述映射 SKU/联名作品 | platform 仅普通索引，外部描述无唯一规则 |
| `SkuInventory` / `InventoryLog` | 四态库存及流水 | 日志幂等键唯一，但调用方生成键时追加时间戳 |

现有 migration SQL 能找到 `auth_codes` 和旧 `shipping_batches`，但找不到 `production_batches`、`batch_items`、`frame_instances`、`order_item_bindings` 的建表语句。仅执行历史迁移创建的新数据库可能缺表。当前无真实用户正是补迁移、做空库重建演练的低成本窗口，但补迁移前仍需先确认哪些批次模型保留。

### 2026-08-23 生产批次骨架更新

上述段落保留的是改造前调查事实。当前已新增独立迁移，补齐 `production_batches`、批次总订单关系和批次单件生产任务关系；`ProductionBatchOrder` 冻结完整 `SO`，`ProductionBatchUnit` 冻结每个 `PU` 及帧素材、材料、配对、打包四条进度。旧导出链路和旧生产模型仍保留，尚未迁入新批次作业，不应与新批次接口混用推进状态。

新增实现包括：

- `/api/admin/production-batches/candidates`：查看可入批总订单、硬性阻断和库存提醒；
- `/api/admin/production-batches`：列出或显式创建生产批次；
- `/api/admin/production-batches/:batchId`：读取冻结订单、全部 `PU`、材料需求和进度；
- `admin-production-batches.html`：生产批次列表、创建和详情页；
- `check:production-batches`：验证整单入批、提醒确认、事务锁定、重复拦截和页面展示。

详细业务规则、已完成边界和后续阶段见 `docs/PRODUCTION_BATCH_WORKFLOW.md`。

## 当前主流程（代码事实）

1. 管理员读取 paid 订单并导出地址。服务端生成秒级 batchId，逐单写 seqNo、batchId、locked。
2. 管理员录入面单，订单进入 processing。
3. 管理员选择 processing 订单导出帧包。ZIP 已开始响应后，代码才 upsert 生产批次、累计 BatchItem、写 FrameInstance、转移 wipFrame，并把订单改 producing。
4. 生产人员扫描面单和订单码。确认结果只保存在当前页面的 `Set` 和等待区数组中。
5. 页面把确认过的订单号数组提交给发货接口，接口把同面单订单批量改 shipped。
6. 进程内任务按 shippedAt 超过 14 天自动改 received，但不写 receivedAt；不同收货入口对联名收益和储备金处理不同。

这条链路没有服务端持久化的“下载任务、生产任务、扫码会话、逐件绑定、发货事务”作为可靠边界。浏览器刷新、响应中断、并发操作或 API 进程重启都可能留下中间状态。

## 外部订单导入事实

- CSV 中映射了“数量”列，但创建订单和锁库存固定按 1 件执行。
- 导入订单的 `userId` 是执行导入的管理员，不是外部买家；这些订单会被视为员工账号的订单。
- 已匹配订单先创建为 paid，再单独锁库存；库存不足只标 `inventoryStatus=insufficient`，订单仍是 paid。
- 未匹配订单 frameCount 为 0、frameUrls/ossPath 为空。若没有明确区分“外部平台已提供内容/无需本站生产”，会进入无法导出帧包的状态。
- resolve 先锁新库存，再更新订单；重复 resolve、更新失败或更换 SKU 时，没有可靠的旧库存释放和稳定幂等保护。
- 整批导入逐行查询和写入，采用部分成功响应，没有导入任务、行级重试状态、文件哈希或审计批次。

## 定时任务与多实例

全部任务在 `fastify.listen()` 成功后于每个 API 进程内启动，没有分布式锁、leader 选举、任务租约或独立 Worker。多实例部署会让相同扫描同时执行。

- 冷却、储备金、预订单释放和自动收货可能并发重复处理或改变业务时间。
- 库存快照和牛量计算先读取全部对象，再逐条执行，规模增大后运行时间和数据库压力线性上升。
- 日任务通过本地时钟计算首次延时，此后每 24 小时 setInterval；进程重启、时区、夏令时和长任务会影响实际触发时间。
- 没有持久任务队列、失败重试、死信、运行记录、超时告警或补跑控制台。

## 安全、性能与一致性风险

| 优先级 | 风险 | 影响 | 建议方向 | 改造复杂度 |
|---|---|---|---|---|
| P0 | 售后列表和处理路由没有鉴权中间件 | 匿名读取售后、收件信息和签名图片；匿名修改会异常，伪造已登录上下文风险更大 | 立即补 role >= 2、字段最小化、回归测试和访问审计 | 低 |
| P0 | 帧包导出在响应后执行生产副作用 | 下载成功不代表写库成功；重试会重复计划量和库存移动 | 持久导出任务，事务内锁定订单，生成产物后原子提交；失败可重试 | 高 |
| P0 | 扫码发货信任客户端确认数组 | 可绕过实际扫码并批量推进订单状态 | 服务端扫码会话和逐件绑定，状态条件更新，发货事务统一库存/正版码/审计 | 高 |
| P0 | Schema 与 migration 漂移 | 新环境缺生产表，部署不可重复 | 确定模型后补迁移，空库 replay、升级演练和 CI 校验 | 中 |
| P1 | 任意状态互转与多个发货/收货入口 | 取消单、已收货单等可被覆盖；财务和库存副作用不一致 | 单一订单状态机与领域服务，乐观版本/条件更新 | 高 |
| P1 | 幂等键统一追加 Date.now() | 网络重试不能去重；重复导出/导入可重复扣转库存 | 由稳定业务事件 ID 生成键，数据库唯一冲突作为成功重放 | 中 |
| P1 | 导出地址并发选择相同 paid 订单 | 重复分批、seqNo/batchId 覆盖、孤立批次 | 事务内 `SELECT ... FOR UPDATE SKIP LOCKED` 或条件更新领取订单 | 中高 |
| P1 | 生产角色可读取完整收件 PII 和原帧 | 权限过宽时扩大隐私与版权泄露面 | 按岗位、批次、任务和时效授权，脱敏展示并记录下载审计 | 中高 |
| P1 | 正版码随机性、唯一性与公开验证限流不足 | 猜码、枚举、一个订单多码和防伪可信度问题 | CSPRNG、高熵码、order 唯一/吊销状态、接口限流与风险监控 | 中 |
| P1 | 外部导入非原子且数量/归属语义不清 | 超卖、错归员工、漏生产或重复锁库存 | 导入暂存表 + 校验/提交两阶段；明确数量和外部客户模型 | 高 |
| P2 | 订单高频字段无索引，批次列表全量内存聚合 | 大批访问下数据库全表扫描和 API 内存增长 | 依据查询计划加组合索引，数据库聚合和游标分页 | 中 |
| P2 | 原帧逐个串行远程拉取，部分内容整包缓冲 | 大订单响应慢、连接占用久、内存不可控 | 后台异步生成、限并发流式下载、对象大小/数量上限、产物缓存 | 高 |
| P2 | CSV 公式注入、编码和解析边界不足 | 管理员打开导出表格时可能执行恶意公式；导入错列 | 使用成熟解析/导出库，公式转义，编码检测和行级校验 | 中 |
| P2 | `production-inventory.html` 权限与 API 契约不匹配 | role 1 页面不可用，容易形成线下绕行 | 先确定岗位权限，再统一请求 schema 和契约测试 | 低中 |
| P2 | 定时任务嵌入每个 API 实例 | 扩容导致重复执行；任务无运行可观测性 | 独立 Worker + 持久队列/锁 + 任务运行表和告警 | 高 |

复杂度含义：低通常为单模块权限/契约修复；中涉及迁移、幂等或多个消费者；高涉及生产状态机、任务基础设施或跨库存/订单/财务事务。复杂度不是优先级，P0 即使复杂也应先阻断风险。

## 文档与代码的主要差异

- `PRODUCTION.md` 描述了三码配对、扫码后扣库存和稳定批次追踪；实际扫码确认未写 `OrderItemBinding`，扫码发货也未调用库存核销。
- `docs/DATABASE.md` 称 `auth_codes` 在扫码发货时生成；当前生产扫码页的发货路由不生成，只有另一条库存发货路由或管理员手工接口生成。
- 文档称 `shipping_batches` 已弃用；旧创建路由仍注册且可写表。
- 文档称库存日志幂等键防止网络重试；生成方法追加当前毫秒，业务重试会得到新键。
- 文档把生产表列为现有数据库结构；Schema 已定义，但历史 migration SQL 未覆盖其中多张表。
- `CLAUDE.md` 将 `production-inventory.html` 标为待开发，文件已经有较完整界面；但当前权限、字段和路由契约不通，应标为“页面已实现、链路不可用”。

完整编号见 `docs/DOC_CODE_DIFFERENCES.md`。

## 待确认事项

项目负责人已于 2026-08-21 开始补充完整生产流程，并确认动画资产、订单商品、单件生产任务、私人帧素材包、标准材料包批次/箱码和联名备货的高层边界，详见 `docs/ANIMATION_ORDER_PRODUCTION_FRAMEWORK.md`。2026-08-22 已完成零件实收、分装、SKU材料清单、材料包组装入库和可复用箱码基础，详见 `docs/STANDARD_KIT_INVENTORY.md`。下列操作细节仍需在对应生产批次编码前确认：

- 最终保留哪一种生产批次模型，以及批次按“主动导出”还是“收件人/面单”划分。
- 扫码和领料的具体操作：私人帧素材包与单件任务必须绑定；普通标准材料包初期按 SKU、批次和箱码领用，最终成品使用单件生产码。仍需确认每个岗位在哪一步扫码以及异常纠错流程。
- 外部平台订单是否由本站生产、如何表达数量，以及是否需要与本站用户账号关联。
- 生产岗位可以查看哪些收件信息和原帧，授权持续到哪个环节。
- 订单状态允许哪些人工回退、谁能紧急越权，以及售后退款/返工如何闭环。

在最终流程确认前，用户资料最小可见、电话和地址按岗位展示、原图短时授权与访问留痕、状态纠错审计等作为安全检查项保留，但不据此推定具体生产操作方式。

2026-08-23 更新：生产批次已经确认按“管理员主动选择完整总订单并创建”划分，批次创建与文件下载分离；该项不再待确认。当前仍待确认的是打印裁切配置、每个岗位的领料/配对扫码动作、异常返工和最终打包发货规则。

2026-08-25 更新：打印裁切配置和批次生产顺序已经实现。新增 `PrintCutGroup`、`PrintCutRule`、`/api/admin/print-production` 和 `admin-print-production.html`；候选订单支持按支付日期、款式、SKU、尺寸、帧数、打印组和来源筛选。创建批次时保存每个 `PU` 的打印组、页数和顺序快照。真实打印文件、标签、岗位完成操作和异常返工仍未实现，详见 `docs/PRINT_PRODUCTION_PLANNING.md`。

## 相关文档

- `PRODUCTION.md`：生产系统原规划
- `docs/modules/commerce-orders-inventory.md`：订单、支付与库存上游
- `docs/modules/collab-creator-revenue.md`：收货后的联名收益下游
- `docs/DOC_CODE_DIFFERENCES.md`：差异与风险编号
- `docs/OPEN_QUESTIONS.md`：需要产品确认的决策
- `docs/ANIMATION_ORDER_PRODUCTION_FRAMEWORK.md`：已确认的跨模块目标编号与生产关系
- `docs/PRODUCTION_BATCH_WORKFLOW.md`：材料包款生产批次、并行作业、阶段边界与验收结果
- `docs/PRINT_PRODUCTION_PLANNING.md`：打印裁切组、候选筛选、生产顺序和批次快照
- `docs/DATABASE.md`、`docs/API.md`、`docs/FRONTEND.md`：旧版横向说明
