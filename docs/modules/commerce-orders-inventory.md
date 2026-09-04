# 商品、订单与库存

> 本文记录该模块当前代码事实；从联名/私人定制、混合购物车、小程序交接、真实支付到生产发货的统一目标路线及 P0/P1 断点见 `../WEB_COMMERCE_END_TO_END.md`。

> 调查日期：2026-08-11
> 本轮覆盖：动画/旧商品、机型与 SKU、定制品草稿、购物车、地址、预订单、支付、用户订单、售后、SKU 库存、材料库存和帧包库存。
> 已完成：逐路由阅读、主要 Schema 对照、Web 前端消费者检索、现有 API/数据库/库存规划文档对照。
> 尚未覆盖：生产批次如何消耗四态库存、外部平台导入订单、真实支付渠道参数、小程序消费者和数据库迁移实况；这些分别留到批次 5、7、8。

> 2026-08-22 实施更新：当前 Web 主流程已经建立 `SalesOrder -> SalesOrderItem -> CustomizeOrder` 三层结构。一次支付只生成一个用户订单；购物车每种商品形成一条订单商品；每条商品再按购买数量展开为单件生产任务。本文后面标注为“调查时风险”的旧结论用于保留历史原因，最新代码事实以“聚合订单实施结果”为准。

## 聚合订单实施结果（2026-08-22）

| 层级 | 当前模型/编号 | 用户或员工看到什么 |
|---|---|---|
| 用户订单 | `SalesOrder` / `SO-YYYYMMDD-XXXXXXXX` | 一次支付只显示一张订单卡片，保存总金额与收件快照 |
| 订单商品 | `SalesOrderItem` / `SO-...-01` | 一种动画版本与 SKU 的成交组合，锁定数量、单价、动画版本和规格快照 |
| 单件生产任务 | `CustomizeOrder` / `PU-YYYYMMDD-XXXXXXXX` | 每一件实物一条任务，继续供现有生产后台排产、扫码、物流和售后使用 |

支付通知以 `PreOrder.preOrderId -> SalesOrder.preOrderId` 唯一关系防止重复落单。重复或并发通知不会创建第二张用户订单。两个购物车条目、数量分别为 1 和 2 时，结果是 1 张用户订单、2 条订单商品、3 条生产任务。

订单列表和详情接口现在优先返回聚合订单及其商品；没有新关系的本地旧 `CustomizeOrder` 继续按单商品旧订单展示。账号注销只删除未成交预订单，已被正式订单引用的支付凭证继续受控保留。

数据库迁移为 `prisma/migrations/20260822150000_add_sales_order_structure/migration.sql`，已于 2026-08-22 应用到本地开发库；正式环境发布时仍需纳入受控迁移和回滚流程。

## 模块职责

这一业务域负责从“可销售内容 + 硬件规格”到“支付订单 + 生产履约”的完整链路：

1. 管理员维护机型、SKU、价格、展示图和库存。
2. 用户创建自己的动画定制品，或选择已上架的联名作品。
3. 商品加入购物车，结算时形成 10 分钟有效的预订单并预锁库存。
4. 支付回调创建一个 `SalesOrder`，把购物车条目转换为 `SalesOrderItem`，再按数量展开生产使用的 `CustomizeOrder`。
5. 用户查看订单、取消、确认收货或申请售后。
6. 生产/管理员管理硬件库存、材料和预制帧包。

当前代码并不是一条统一链路，而是新旧两代商品和下单方式并存。

## 技术实现

- API 使用 Fastify 路由，数据库通过 Prisma 访问 PostgreSQL。
- 价格字段主要使用 Prisma `Decimal`，但联名分账模型使用 `Float`，部分响应再转成 JavaScript `Number`。
- 库存写入混合使用 Prisma 常规更新、事务和 `$executeRaw` 条件更新。
- 支付目前只有回调骨架、状态轮询和非生产环境 Mock，没有接通并验证真实微信支付通知。
- 预订单过期、定制品清理、自动收货由 API 进程内 `lib/scheduler.js` 定时执行。
- Web 前端是页面内原生 JavaScript，通过 Bearer Token 调用 API。

## 两代商品与订单体系

| 体系 | 核心模型 | 入口 | 当前消费者 | 判断 |
|---|---|---|---|---|
| 旧动画商品 | `Animation`、`AnimationFrame`、`Product`、`OrderExt`、`Earning` | `/api/animations`、`/api/products` | `creator-profile.html`；旧版 `_legacy/work-detail.html` | 仍注册可用，但已不是主购物流程 |
| 旧直接定制订单 | `CustomizeOrder` | `/api/customize-orders` | 未找到 Web 调用者 | 可直接创建待付款订单并锁 1 件库存，与新购物车流程并存 |
| 当前定制/联名购物 | `CustomProduct`、`CartItem`、`PreOrder`、`CustomizeOrder`、`CollabOrder` | `/api/custom-products`、`/api/cart`、`/api/payment`、`/api/orders` | 定制编辑/确认、联名确认、购物车、结算、订单页 | 当前 Web 主流程 |

无真实用户意味着旧流程不必承担线上历史账号兼容，但删除前仍须迁移或确认本地页面、脚本和测试数据的调用关系。

## 文件与依赖关系

| 文件 | 作用 | 主要依赖 / 后续连接 |
|---|---|---|
| `routes/machine-models.js` | 机型与 SKU 公共查询、管理、排序、定价和图片上传 | `MachineModel`、`MachineModelSku`、`SkuInventory`、OSS |
| `routes/animations.js` | 旧动画及逐帧上传 | `Animation`、`AnimationFrame`、OSS |
| `routes/products.js` | 旧商品发布、审核状态查询、修改、软删除 | `Product`、`Animation`、用户认证状态 |
| `routes/customize-orders.js` | 旧式直接创建/查询/取消定制订单 | `CustomizeOrder`、`lib/inventory.js` |
| `routes/custom-products.js` | 用户定制草稿、配额、重命名和预览再生成 | `CustomProduct`、`MachineModelSku` |
| `routes/cart.js` | 购物车、游客合并、实时价格/库存、结算和预锁 | `Cart`、`CartItem`、`PreOrder`、`CollabWork`、`CustomProduct`、SKU 库存 |
| `routes/payment.js` | 支付通知、状态轮询、开发 Mock、支付后建立订单头/商品/单件任务 | `PreOrder`、`SalesOrder`、`SalesOrderItem`、`CustomizeOrder`、`CustomProduct` |
| `routes/orders.js` | 聚合订单列表/详情、取消、收货和售后；兼容旧单件订单 | `SalesOrder`、`SalesOrderItem`、`CustomizeOrder`、`AftersaleRequest`、库存服务 |
| `lib/sales-orders.js` | 生成 `SO`、订单商品和 `PU` 编号，按单件任务汇总用户订单状态 | 聚合订单和生产任务 |
| `routes/addresses.js` | 每用户最多 20 个地址及默认地址 | `UserAddress` |
| `routes/inventory.js` | 四态库存、预警、日志、快照、渠道配额和发货核销 | `lib/inventory.js`、`lib/material-inventory.js`、OSS |
| `lib/inventory.js` | 可售计算、锁定/释放、转在制、扣减和手工调整 | `SkuInventory`、`InventoryLog` |
| `lib/scheduler.js` | 预订单过期、定制品清理、自动收货 | `PreOrder`、`CustomProduct`、`CustomizeOrder` |
| `routes/materials.js` | 包装等材料、入库/报废/盘点、SKU 绑定 | `MaterialItem`、`MaterialLog`、`MaterialSkuBinding` |
| `lib/material-inventory.js` | 按 SKU 绑定在发货后扣材料 | 材料三张表 |
| `routes/frame-packs.js` | 预制帧包白名单、规格库存和日志 | `FramePackWork`、`FramePackVariant`、`FramePackLog` |

## API 与权限

### 公共查询

- `/api/machine-models`：已启用机型、SKU、SKU 销量查询。
- `/api/products`：旧商品列表和详情；详情没有强制只返回已发布商品。
- `/api/inventory/verify/:code`：通过正版码查询订单和作品信息。

### 登录用户

- `/api/animations`、`/api/products/mine`：旧创作和商品管理。
- `/api/customize-orders`：旧式直接下单、列表、详情、取消。
- `/api/custom-products`：创建、查询、修改、删除定制草稿；普通用户最多 3 个，认证创作者最多 10 个。
- `/api/cart`：购物车读取、加入、修改、删除、清空、游客合并、结算、确认价格变化。
- `/api/addresses`：地址增删改查和默认地址。
- `/api/payment/status/:preOrderId`、`/mock-pay/:preOrderId`：支付状态和开发模拟支付。
- `/api/orders`：自己的订单、取消、收货、申请/查询售后。

### 支付通知

- `POST /api/payment/callback` 对支付平台公开是正常需求，但当前没有验证平台签名、交易号、支付金额、币种或通知重放。

### 生产与管理员

- `/api/machine-models` 的管理写接口要求 `role >= 2`。
- `/api/inventory` 的大部分查看/设置要求管理员，入库和发货允许生产角色。
- `/api/materials` 当前全部管理接口要求管理员。
- `/api/frame-packs` 的查看和入库允许生产角色，白名单/变体配置要求管理员。
- 这一业务域存在多套手写角色判断；`inventory.js` 的表达式会让 `role=1` 通过名为 `requireAdmin` 的检查，实际权限比注释宽。

## 数据模型

### 销售与订单

| 模型 | 作用 | 关键事实 |
|---|---|---|
| `MachineModel` | 机型 | 公共启用状态、排序和规格说明 |
| `MachineModelSku` | 可销售规格 | 尺寸、材质、帧数、颜色、价格、图片、SKU 编码、条码和授权状态 |
| `CustomProduct` | 用户 DIY 草稿 | `draft -> in_cart -> ordered/removed`，默认 7 天过期 |
| `Cart` / `CartItem` | 用户购物车 | 条目类型 `MARKET` 或 `CUSTOM`，保存数量、加购时价格和当前选中状态 |
| `PreOrder` | 支付前快照 | 总金额、地址快照、购物车条目 ID JSON、唯一幂等键、10 分钟过期 |
| `SalesOrder` | 用户订单头 | 一次支付一条；保存总金额、地址、支付时间和用户侧状态 |
| `SalesOrderItem` | 订单商品 | 锁定动画资产/版本、SKU、规格、单价、数量和行金额 |
| `CustomizeOrder` | 单件生产任务 | 每件实物一条，关联订单商品，保存生产编号、SKU、帧、批次和履约状态 |
| `AftersaleRequest` | 售后单 | 退款/质量问题、凭证图、审核状态；每单申请次数上限由路由控制 |
| `CollabOrder` | 联名销售和分账快照 | 必填创作者、成交价、分红率和分红金额；支付回调当前无法按 Schema 创建 |

### 三套库存

| 库存 | 模型 | 用途 | 当前连接情况 |
|---|---|---|---|
| 硬件 SKU 四态库存 | `SkuInventory`、`InventoryLog`、`InventorySnapshot`、`ChannelQuota` | 现货、支付/订单锁定、帧制在制、料制在制 | MARKET 购物车结算会预锁；CUSTOM 购物车不会预锁 |
| 零件与材料包库存 | `MaterialItem`、`MaterialReceipt`、`MaterialPreparationBatch`、`MaterialSkuBinding`、`KitAssemblyBatch`、`KitContainer` | 实收入库、分装、SKU材料清单和标准材料包组装 | 组装入库已原子扣零件并增加材料包；生产任务领料和采购批次精确分配待完成 |
| 帧包库存 | `FramePackWork`、`FramePackVariant`、`FramePackLog` | 联名作品帧包预制备货 | 目前主要是后台独立维护，未接入购物车配额或销售消耗 |

`ContentQuota` 还定义了联名限量配额，但在源代码中未找到实际读写消费者。

## 当前 Web 主流程

### 定制品

1. `customize-start.html` 读取机型和 SKU。
2. `customize-editor.html` 创建/更新 `CustomProduct` 草稿。
3. `customize-confirm.html` 把草稿加入 `CUSTOM` 购物车。
4. `cart.html` 修改数量和选择状态。
5. `checkout.html` 选择地址并调用 `/api/cart/checkout`。
6. 后端创建 `PreOrder`；当前只为 `MARKET` 条目预锁硬件库存。
7. Mock 或真实支付回调创建一个 `SalesOrder`；每个购物车条目形成 `SalesOrderItem`，再按数量展开单件 `CustomizeOrder`。

### 联名作品

1. 展示/确认页选择 `CollabWork` 和硬件 SKU。
2. `/api/cart/add` 创建 `MARKET` 条目。
3. 结算按 SKU 基础价计算金额并预锁 `quantity` 件硬件库存。
4. 支付回调创建一个 `CustomizeOrder`，再尝试创建 `CollabOrder`。
5. 当前 `CollabOrder` 创建参数与 Schema 不匹配，错误被捕获后支付仍返回成功，因此分账链路实际中断。

### 订单状态

Schema 注释的主状态为：

`pending -> paid -> locked -> processing -> producing -> shipped -> received -> aftersale/cancelled`

代码中还出现 `done`，但它不在上述统一状态说明中。自动收货任务只处理设置了 `shippedAt` 且发货满 14 天的订单；`/api/inventory/ship` 虽把状态改为 `shipped`，却没有写 `shippedAt`。

## 价格、数量和库存语义

- 购物车金额是 `MachineModelSku.price * CartItem.quantity`。
- 联名详情页展示价是 SKU 基础价加 `CollabWork.creatorMarkups[skuId]`，但购物车只取 SKU 基础价，未计创作者加价。
- **已修复：**`CustomizeOrder` 明确表示单件生产任务；`SalesOrderItem.quantity` 保存购买数量，并按数量生成对应任务。
- **已修复：**总金额保存在 `SalesOrder`，单价和行金额保存在 `SalesOrderItem`；生产任务不再承担用户订单金额。
- 文档定义可用库存为 `currentStock - reservedStock - wipFrameQty - wipKitQty`。购物车结算使用了完整公式，但 `lib/inventory.js` 漏减 `wipKitQty`，旧下单和后台库存视图会高估可售量。

## 已确认的文档与代码差异

1. `DATABASE.md` 要求所有库存写入收口到 `lib/inventory.js`，购物车结算和多条路由直接更新库存表。
2. 文档规定预订单幂等键为 `sha256(userId + sortedCartItemIds)`；前端不发送键，后端回退值含当前时间，同一结算重试会生成新键。
3. 文档称预订单超时 Cron 自动释放库存；状态轮询和支付失败会先把状态改成过期/取消，却不释放库存，之后 Scheduler 也不会再选中它。
4. API 文档称支付成功事务内创建联名订单；当前参数与 Schema 不匹配，实际创建失败且异常被忽略。
5. 库存规划文档与 Schema 使用四态可用量，公共库存函数只计算了三态。
6. 文档称支付回调“当前 Mock”，架构又列为支付闭环；代码尚不具备真实支付通知验签和金额核验。
7. `maxOrderLimit` 和 `ContentQuota` 已有配置/模型，但下单链路未执行限制。
8. 材料规划称发货成功后自动扣减，这一调用已存在；但失败被忽略、无重试，且并发扣减方式会覆盖其他更新。

## 上线前阻断风险

| 风险 | 当前结果 | 建议方向 |
|---|---|---|
| 支付回调无验签 | 知道预订单 ID 的人可伪造支付成功 | 接入支付方官方 SDK/证书验签，核验商户号、订单号、金额、币种、交易状态和重放 |
| 联名订单无法落库 | 支付成功但没有分账记录 | 统一 `CollabOrder` 契约，在同一事务内按成交快照创建；失败必须使回调失败并可安全重试 |
| 加购/合并数量未校验 | 零数、负数或异常大数量可污染金额和库存 | 在所有入口统一校验正整数、上限和逐 SKU 限购 |
| 数量与生产订单模型冲突 | **已修复基础结构：**多件商品已按数量展开 `PU` 单件任务 | 后续继续统一拆分售后、分账和包裹关系 |
| 联名加价未进入结算 | 展示价与实付价、创作者收益不一致 | 建立服务端价格快照服务，禁止各路由各自算价 |
| 过期/失败库存不释放 | 库存永久占用，商品错误售罄 | 状态变更和释放放进单事务，增加幂等状态机和补偿扫描 |
| CUSTOM 不锁硬件库存 | 定制品可超卖 | 明确所有实物是否共享 SKU 库存；若共享，结算统一锁定 |
| 结算非原子 | 锁库存成功但预订单创建失败时产生孤儿锁 | 锁定、预订单和条目快照在一个数据库事务中完成 |
| 幂等键含时间戳 | 重试不会命中同一操作 | 幂等键由稳定业务标识生成，保存请求结果并处理唯一键并发冲突 |

## 其他安全、性能和一致性风险

- MARKET 加购只检查作品存在和支持 SKU，没有强制 `approved + isOnShelf + shelfStatus=on_sale`，也未检查 SKU 启用、限购和内容配额。
- 购物车读取对每个条目逐个查价格、库存和状态，形成 N+1 查询，大购物车或高并发时数据库压力明显。
- `cart.js` 使用 `work.coverImageUrl`，Schema 字段是 `coverUrl`，联名购物车封面可能为空。
- 结算收件人、电话、地址只有前端校验，API 没有完整的必填、长度和格式校验。
- 旧 `/api/customize-orders` 信任客户端提供的机型/规格/帧信息，SKU 可选且不核对启用状态和规格一致性。
- 支付失败回调和支付状态轮询不会释放库存。
- Scheduler 的释放动作先改库存、再改预订单，且没有分布式锁；进程中断或多 API 实例可能重复释放。
- `makeIdempotencyKey()` 总是拼接当前时间，被库存入库、导入、在制和取消等流程复用，无法防止重试重复写。
- 创建 SKU 后再单独创建库存，不在一个事务中；第二步失败会留下无库存记录的 SKU。
- SKU/机型批量排序使用 `Promise.all`，没有事务和完整归属校验，部分失败会留下半完成顺序。
- 材料和帧包库存采用“先读再写绝对值”，并发操作可能丢失更新。
- 2026-08-22 已移除“发货后异步扣零件”。材料包组装入库会先检查全部零件，并在一个事务中扣零件和增加材料包库存；不足时整笔拒绝。历史风险不再适用于该入口，领料和其他旧生产入口仍需后续统一。
- 材料扣减在发货事务后异步执行，错误只写日志；没有订单级唯一约束，重复调用也可能重复扣料。
- `/api/inventory/ship` 本身不扣 SKU 当前库存，依赖之前生产步骤；同时不写 `shippedAt`，自动收货无法覆盖该路径。
- 旧商品详情对任意未软删除商品公开，包括待审核或驳回状态。
- SKU 销量统计包含代码中的 `done` 状态，却漏掉 Schema 流程中的 `received`，热门排序可能失真。
- 真实支付、退款、取消、售后通过后的资金逆向和库存补偿尚未形成一套可审计状态机。

## 已实现得较稳妥的部分

- 地址 CRUD 会检查归属，每用户限制 20 条，并用事务维护唯一默认地址。
- 结算会复制收货地址快照，后续修改地址簿不会改变历史预订单。
- 购物车数量“更新”接口限制为 1 到 100；问题集中在首次加入和游客合并入口。
- 支付建生产订单和删除购物车条目位于 Prisma 事务内；联名订单异常被吞掉是这一事务保护的例外。
- `inventory_logs.idempotencyKey` 和 `PreOrder.checkoutIdempotencyKey` 有唯一约束，数据库基础能力已具备，只需修正键和调用方式。
- 定制草稿处于购物车时不会被 7 天清理任务误删。

## 已确认产品规则

1. 用户侧一个订单可以包含多件商品；每件实物分别生成生产/履约任务和独立生产码，同一订单中的多件商品仍可合并成一个物流包裹。
2. 已确认相同实体硬件需要统一可售口径，不能因 CUSTOM 与 MARKET 使用彼此无关的库存数造成超卖；最终是否沿用当前四态模型及其字段语义，待完整生产流程确认。
3. “付款预留、扫码转在制、完工转成品待发、发货只改物流”的方案仅作为此前讨论形成的候选流程保留，不是最终产品规则。扣减时点、取消、退款和损耗处理在实际改造库存/生产模块前重新确认。
4. 联名款允许根据销售预测提前生产成品。前台不区分预制、现货或现做，只展示统一商品和可信预计发货时间；后台优先分配可用成品，缺货时自动创建现做任务。帧包或成品库存不足原则上不阻止下单，但必须触发排程、预警并调整预计交付时间。
5. 普通线上订单同一 SKU 每单默认最多 10 件，超过后引导到企业微信办理人工大宗订单；后台可创建已审核的批量订单。限量联名可另外配置按用户和活动周期计算的限购数，所有限制必须由服务端执行。
6. 未付款订单可直接取消；已付款未开工可申请取消退款。个性化定制开工后不支持无理由取消，但质量、确认内容不符或平台责任仍进入售后；标准联名款按普通实物商品规则处理。付款前必须显著确认定制例外。
7. 动画资产、动画版本、定制项目、用户订单、订单商品和单件生产任务必须分开。一次支付形成一个用户订单；订单商品按数量展开为单件生产任务。当前 `CustomizeOrder` 同时承担用户订单和生产任务的实现需要改造。
8. 用户确认的私人动画可用于以后购买其他兼容 SKU；用户可从前台删除，但后台按历史订单、售后、争议和受控留存规则保留必要内容。联名动画和商品不可由用户删除，只能下架或归档。
9. 私人帧素材包只按订单现做；获得授权的联名帧素材或成品才允许依据销售预测备货。标准材料包首版采用 SKU、批次、箱码和数量追踪，最终成品及私人帧素材包仍需绑定单件生产任务。

跨模块目标结构、编号和实施顺序见 `docs/ANIMATION_ORDER_PRODUCTION_FRAMEWORK.md`。上述内容是已确认目标，不表示现有 Schema 和 API 已完成。

## 待确认事项

1. 旧 `Animation/Product` 与 `/api/customize-orders` 是否确定退出首发范围？当前没有真实用户，建议完成消费者迁移后移除，降低双轨复杂度。
2. 联名创作者加价是否全部计入成交价及分红基数？退款、优惠、运费又如何分摊？
3. CUSTOM/MARKET 的统一可售口径最终使用哪些库存状态，付款、开工、完工、发货、取消和损耗分别怎样改变库存；此项待项目负责人讲解完整生产流程后确认。

## 相关文档

- `docs/API.md`：现有接口说明，需结合本文件中的差异阅读。
- `docs/DATABASE.md`：表设计和原始一致性规则。
- `docs/admin-inventory-plan.md`：后台库存与材料规划。
- `docs/USER_SCENARIOS.md`：联名下架、预存库存、押金和售罄待定规则。
- `docs/ANIMATION_ORDER_PRODUCTION_FRAMEWORK.md`：动画资产、聚合订单、单件任务、帧素材包和标准材料包的目标关系。
- `docs/STANDARD_KIT_INVENTORY.md`：零件实收、分装、SKU材料清单、材料包入库、误差与箱码的当前实现。
- `docs/DOC_CODE_DIFFERENCES.md`：跨文档差异编号台账。
- `docs/OPEN_QUESTIONS.md`：需要项目负责人决定的规则。
