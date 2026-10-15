# 商品、订单与库存

> 本文记录该模块当前代码事实；从联名/私人定制、混合购物车、小程序交接、真实支付到生产发货的统一目标路线及 P0/P1 断点见 `../WEB_COMMERCE_END_TO_END.md`。

> 初次调查：2026-08-11；最近复核：2026-09-08。
> 当前覆盖：机型与 SKU、私人定制、联名商品、混合购物车、地址、付款前快照、模拟支付、正式订单、生产衔接和三层材料库存。
> 当前未闭环：小程序安全领取、真实微信支付、退款售后、联名成品库存优先和多实例任务保障。

> 2026-08-22 实施更新：当前 Web 主流程已经建立 `SalesOrder -> SalesOrderItem -> CustomizeOrder` 三层结构。一次支付只生成一个用户订单；购物车每种商品形成一条订单商品；每条商品再按购买数量展开为单件生产任务。本文后面标注为“调查时风险”的旧结论用于保留历史原因，最新代码事实以“聚合订单实施结果”为准。

> 2026-09-07 混合结算更新：`CUSTOM` 与 `MARKET` 已使用同一套服务端结算快照、库存预占和支付落单构建器。`PreOrder.checkoutSnapshot` 冻结商品、动画版本、SKU、价格、数量、地址和帧文件；两类商品在同一事务内共同预占材料包库存。支付成功只读取冻结快照，建立一个 `SO`、多条 `SalesOrderItem` 和按数量展开的 `PU`。本文后面与此冲突的“调查时风险”只保留历史背景，不再代表当前实现。

> 2026-09-08 迁移基线更新：交易工作区和订单履约时间已补入可重放迁移。当前职责边界为：`SalesOrder` 表示一次用户总订单，`SalesOrderItem` 固化成交商品快照，`CustomizeOrder` 一条记录代表一件生产/物流任务；前两者的用户可见 `status` 与总订单的内部 `fulfillmentStatus` 不应互相替代。支付仍由 `ONLINE_CHECKOUT_ENABLED=false` 关闭，剩余预订单/草稿类型规则将在交易状态机专项中收口。

> 2026-10-15 客户订单展示复核：`/api/orders/mine` 与 `/api/orders/:id` 的客户响应只返回 SO 与成交商品信息，不再返回 PU 任务列表或编号。PU 的 `batchId` 在 PB 创建时写入，客户摘要据此区分“已付款”与“制作中”；取消操作在事务里再次检查任务未入批。此处仅描述客户展示边界，60 分钟暂缓履约、退款资金闭环仍待后续批次实现。

> 2026-09-08 SKU/库存迁移更新：`20260908140000_add_sku_inventory_schema` 已补齐库存服务真实依赖的四态库存、库存日志幂等字段、SKU 编码/授权字段、平台映射、库存快照、订单配对和渠道配额；隔离空库 55/55 重放及库存服务事务冒烟通过。此处只确认代码与空库结构可匹配，**不**代表库存、生产或外部平台的完整业务状态机已验收；跨表外键、SKU 编码唯一性和旧日志约束仍由 P0-D/P0-F 审计后决定。

## 聚合订单实施结果（2026-08-22）

| 层级 | 当前模型/编号 | 用户或员工看到什么 |
|---|---|---|
| 用户订单 | `SalesOrder` / `SO-YYYYMMDD-XXXXXXXX` | 一次支付只显示一张订单卡片，保存总金额与收件快照 |
| 订单商品 | `SalesOrderItem` / `SO-...-01` | 一种动画版本与 SKU 的成交组合，锁定数量、单价、动画版本和规格快照 |
| 单件生产任务 | `CustomizeOrder` / `PU-YYYYMMDD-XXXXXXXX` | 每一件实物一条任务，继续供现有生产后台排产、扫码、物流和售后使用 |

支付通知以 `PreOrder.preOrderId -> SalesOrder.preOrderId` 唯一关系防止重复落单。重复或并发通知不会创建第二张用户订单。两个购物车条目、数量分别为 1 和 2 时，结果是 1 张用户订单、2 条订单商品、3 条生产任务。

订单列表和详情接口现在优先返回聚合订单及其商品；没有新关系的本地旧 `CustomizeOrder` 仍有兼容展示代码。项目没有真实用户，这些旧记录和兼容分支应在测试数据清理、旧消费者确认后删除，不作为长期双轨设计。账号注销只删除未成交预订单，已被正式订单引用的支付凭证继续受控保留。

数据库迁移为 `prisma/migrations/20260822150000_add_sales_order_structure/migration.sql`，已于 2026-08-22 应用到本地开发库；正式环境发布时仍需纳入受控迁移和回滚流程。

混合结算新增迁移为 `prisma/migrations/20260907150000_add_checkout_snapshot/migration.sql`，增加付款前 JSON 快照和订单商品价格/供货字段。由于本地历史迁移表仍存在早期失败记录，本次只对当前开发库执行了该增量 SQL；正式发布前必须先完成数据库基线整理，再用全新空库验证完整 `migrate deploy`，不能把本地直接执行 SQL 当作正式发布流程。

## 模块职责

这一业务域负责从“可销售内容 + 硬件规格”到“支付订单 + 生产履约”的完整链路：

1. 管理员维护机型、SKU、价格、展示图和库存。
2. 用户创建自己的动画定制品，或选择已上架的联名作品。
3. 商品加入购物车，结算时形成 10 分钟有效的不可变预订单快照，并原子预锁本单全部 SKU 库存。
4. 支付回调创建一个 `SalesOrder`，把购物车条目转换为 `SalesOrderItem`，再按数量展开生产使用的 `CustomizeOrder`。
5. 用户查看订单、取消、确认收货或申请售后。
6. 生产/管理员管理硬件库存、材料和预制帧包。

当前 Web 正式购买已统一走购物车、`PreOrder` 和聚合订单链路；旧动画商品和旧直接下单路由仍是后续代码退役事项，不能再作为新功能入口。

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
| 旧直接定制订单 | `CustomizeOrder` | `/api/customize-orders` | 当前正式 Web 未使用；路由仍在 `index.js` 注册 | 待删除旧代码，不能继续增加功能 |
| 当前定制/联名购物 | `CustomizationRequest`、`AnimationAsset/Version`、`CustomProduct`、`CartItem`、`PreOrder`、`SalesOrder/Item`、`CustomizeOrder` | `/api/customization-requests`、`/api/animation-assets`、`/api/cart`、`/api/payment`、`/api/orders` | 定制、联名详情、购物车、结算、订单和生产 | 唯一正式 Web 主流程 |

无真实用户意味着旧流程不必承担线上历史账号兼容，但删除前仍须迁移或确认本地页面、脚本和测试数据的调用关系。

## 文件与依赖关系

| 文件 | 作用 | 主要依赖 / 后续连接 |
|---|---|---|
| `routes/machine-models.js` | 机型与 SKU 公共查询、管理、排序、定价和图片上传 | `MachineModel`、`MachineModelSku`、`SkuInventory`、OSS |
| `routes/animations.js` | 旧动画及逐帧上传 | `Animation`、`AnimationFrame`、OSS |
| `routes/products.js` | 旧商品发布、审核状态查询、修改、软删除 | `Product`、`Animation`、用户认证状态 |
| `routes/customize-orders.js` | 旧式直接创建/查询/取消定制订单 | `CustomizeOrder`、`lib/inventory.js` |
| `routes/custom-products.js` | 用户定制草稿、配额、重命名和预览再生成 | `CustomProduct`、`MachineModelSku` |
| `routes/cart.js` | 登录购物车、实时价格/库存、混合结算、地址校验和事务化预锁 | `Cart`、`CartItem`、`PreOrder`、结算快照、SKU 库存 |
| `lib/checkout-snapshot.js` | 统一复核 `CUSTOM/MARKET`、冻结不可变快照、汇总预锁及释放库存 | 联名公开销售服务、动画资产、SKU 和库存日志 |
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
- `/api/cart`：登录购物车读取、加入、修改、删除、清空、结算和确认价格变化。首版没有游客购物车；未登录购买使用短期 `pendingPurchase`，登录后再正式加购。
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
| `PreOrder` | 支付前整单快照 | 总金额、地址、完整商品/动画/SKU/价格/帧文件快照、唯一幂等键、10 分钟过期 |
| `SalesOrder` | 用户订单头 | 一次支付一条；保存总金额、地址、支付时间和用户侧状态 |
| `SalesOrderItem` | 订单商品 | 锁定动画资产/版本、SKU、规格、基础价、价格调整、最终单价、数量、行金额、供货方式和交期 |
| `CustomizeOrder` | 单件生产任务 | 每件实物一条，关联订单商品，保存生产编号、SKU、帧、批次和履约状态 |
| `AftersaleRequest` | 售后单 | 退款/质量问题、凭证图、审核状态；每单申请次数上限由路由控制 |
| `CollabOrder` | 旧联名分账记录 | 仅在创作者财务开关启用时尝试写入；首发关闭，不是当前订单成立条件，未来收益系统需要重构 |

### 三套库存

| 库存 | 模型 | 用途 | 当前连接情况 |
|---|---|---|---|
| 硬件 SKU 四态库存 | `SkuInventory`、`InventoryLog`、`InventorySnapshot`、`ChannelQuota` | 现货、支付/订单锁定、帧制在制、料制在制 | `MARKET` 与 `CUSTOM` 混合结算共同预锁；可用量扣除两种在制数量 |
| 零件与材料包库存 | `MaterialItem`、`MaterialReceipt`、`MaterialPreparationBatch`、`MaterialSkuBinding`、`KitAssemblyBatch`、`KitContainer` | 实收入库、分装、SKU材料清单和标准材料包组装 | 组装入库已原子扣零件并增加材料包；生产任务领料和采购批次精确分配待完成 |
| 帧包库存 | `FramePackWork`、`FramePackVariant`、`FramePackLog` | 联名作品帧包预制备货 | 目前主要是后台独立维护，未接入购物车配额或销售消耗 |

联名作品运营页上的旧 `CollabFramePack` 轻量库存于 2026-09-28 增加独立的 `CollabFramePackMutation` 幂等记录。类型与数量通过单次事务变更，同一 `clientRequestId` 重试不得重复增减；库存不能低于已占用数量。它仍不同于生产履约使用的 `FramePackWork/Variant/Log`，后续统一库存模型前不可把两套记录相互冒充或直接汇总。

`ContentQuota` 还定义了联名限量配额，但在源代码中未找到实际读写消费者。

## 当前 Web 主流程

### 定制品

1. Vue `/app/customize` 选择定制入口和基础机型。
2. Vue `/app/customize/editor` 保存私有素材、`CustomProduct` 帧草稿和 `CustomizationRequest` 定制草稿。
3. Vue `/app/customize/confirm` 选择兼容 SKU，确认定制记录后以用户绑定幂等键把对应商品加入 `CUSTOM` 购物车。
4. `cart.html` 修改数量和选择状态。
5. `checkout.html` 选择地址并调用 `/api/cart/checkout`。
6. 后端在同一事务中复核全部条目、创建不可变 `PreOrder` 快照并预锁两类商品共同使用的 SKU 库存。
7. Mock 或真实支付回调创建一个 `SalesOrder`；每个购物车条目形成 `SalesOrderItem`，再按数量展开单件 `CustomizeOrder`。

### 联名作品

1. `showcase.html` 浏览正式在售联名商品，`showcase-detail.html` 选择 `CollabWork` 对应的正式销售 SKU。
2. `/api/cart/add` 创建 `MARKET` 条目。
3. 2026-09-04 起，列表、详情、加购和结算统一读取 `CollabSaleSku.finalPrice`；结算冻结基础价、价格调整和最终价。
4. 支付回调从快照建立聚合 `SalesOrder`，并为联名商品写入动画资产、版本、帧文件和单件生产任务。
5. 首发线上分红仍关闭；`CollabOrder` 旧分账路径不作为本轮交易成功条件，未来收益系统须单独重构。

### 订单状态

Schema 注释的主状态为：

`pending -> paid -> locked -> processing -> producing -> ready_to_ship -> shipped -> received/aftersale/cancelled`

用户订单状态由 `SalesOrder` 根据单件 `PU` 汇总；正式生产扫码和发货应只走现有生产工作流。旧库存发货路由和旧 `done` 状态仍存在，是后续退役对象，不能与正式生产入口并行扩展。

## 价格、数量和库存语义

- 私人定制商品当前以 `MachineModelSku.price` 为价格基础；联名商品以正式 `CollabSaleSku.finalPrice` 为唯一顾客成交价来源。
- **已修复：**联名列表、详情、加入购物车、购物车读取和结算复核使用相同的正式最终价；旧 `creatorMarkups` 只作兼容镜像，不再由公开购买路线读取。
- **已修复：**`CustomizeOrder` 明确表示单件生产任务；`SalesOrderItem.quantity` 保存购买数量，并按数量生成对应任务。
- **已修复：**总金额保存在 `SalesOrder`，单价和行金额保存在 `SalesOrderItem`；生产任务不再承担用户订单金额。
- 可用库存统一为 `currentStock - reservedStock - wipFrameQty - wipKitQty`；2026-09-07 已修复公共库存函数漏减材料线在制数量的问题。

## 当前文档与代码差异

1. `API.md`、`DATABASE.md`、`PRODUCTION.md` 仍描述旧直接订单、旧库存写入和旧发货入口，必须按当前 `SO -> Item -> PU -> PB -> FP` 路线重写。
2. `/api/customize-orders` 仍注册可用，但正式 Web 已不再调用；测试数据和消费者确认后应删除，不能长期兼容。
3. 真实微信回调仍未验签；当前只能使用非生产环境 Mock 验证订单构建。
4. `CollabOrder` 和旧分红模型仍在 Schema/代码中，但首发创作者财务关闭；未来收益系统应基于成交快照重构。
5. `maxOrderLimit` 和 `ContentQuota` 等旧限量字段仍有未统一消费者；当前顾客购物数量由正式货架与购物车统一限制为 1 至 10。
6. 联名成品/预制帧包库存尚未接入“有库存优先消耗，无库存转现做”的正式分配逻辑。

## 上线前阻断风险

| 风险 | 当前结果 | 建议方向 |
|---|---|---|
| 支付回调无验签 | 知道预订单 ID 的人可伪造支付成功 | 接入支付方官方 SDK/证书验签，核验商户号、订单号、金额、币种、交易状态和重放 |
| 小程序领取缺失 | Web 付款前整单不能安全绑定微信身份 | 使用不可猜测的一次性领取码摘要、领取状态、手机号核对和防重复领取 |
| 真实支付回调无验签 | 知道付款前记录的人可能伪造成功 | 接入微信官方支付能力，核验签名、商户、订单、金额、币种和重放 |
| 售后资金与库存未闭环 | 退款成功、生产取消和库存返还可能不一致 | 建立按订单商品/单件的售后状态机、补偿任务和审计 |
| 联名成品库存未接入 | 允许现做与当前缺货判断可能冲突 | 后台优先分配成品库存，缺货时建立现做任务并计算可信交期 |
| 多实例定时任务未验证 | 多个 API 实例可能重复处理超时或补偿 | 引入任务租约或独立 Worker，并配置失败告警和人工重试 |

## 其他安全、性能和一致性风险

- 联名列表、详情、加购和结算已经共用正式在售判断；未来修改时仍需用反向测试防止绕过。
- 购物车读取对每个条目逐个查价格、库存和状态，形成 N+1 查询，大购物车或高并发时数据库压力明显。
- 正式联名购物车使用销售展示封面；旧审核封面字段不再作为顾客商品真相来源。
- 结算已经在服务端校验收件人、手机号、城市和详细地址；更完整的行政区编码和地址标准化留到物流接入阶段。
- 旧 `/api/customize-orders` 信任客户端提供的机型/规格/帧信息，SKU 可选且不核对启用状态和规格一致性。
- 支付失败、购物车修改和超时已经共用关闭并释放库存的事务函数；多实例任务租约和释放失败告警仍待验证。
- `makeIdempotencyKey()` 总是拼接当前时间，被库存入库、导入、在制和取消等流程复用，无法防止重试重复写。
- 创建 SKU 后再单独创建库存，不在一个事务中；第二步失败会留下无库存记录的 SKU。
- SKU/机型批量排序使用 `Promise.all`，没有事务和完整归属校验，部分失败会留下半完成顺序。
- 材料和帧包库存采用“先读再写绝对值”，并发操作可能丢失更新。
- 2026-08-22 已移除“发货后异步扣零件”。材料包组装入库会先检查全部零件，并在一个事务中扣零件和增加材料包库存；不足时整笔拒绝。历史风险不再适用于该入口，领料和其他旧生产入口仍需后续统一。
- 旧 `/api/inventory/ship` 与正式扫码发货路径并存，后续应删除旧消费者和路由，避免产生第二套库存副作用。
- 2026-10-08 起，`POST /api/inventory/:skuId/restock` 强制携带 `clientRequestId`；库存流水保存请求指纹并校验操作人。同键同内容重放不会再次增减，同键改内容返回冲突，并发重放由数据库唯一键恢复原结果。
- 旧商品详情对任意未软删除商品公开，包括待审核或驳回状态。
- SKU 销量统计包含代码中的 `done` 状态，却漏掉 Schema 流程中的 `received`，热门排序可能失真。
- 真实支付、退款、取消、售后通过后的资金逆向和库存补偿尚未形成一套可审计状态机。

## 已实现得较稳妥的部分

- 地址 CRUD 会检查归属，每用户限制 20 条，并用事务维护唯一默认地址。
- 结算会复制收货地址快照，后续修改地址簿不会改变历史预订单。
- 购物车首次加入、已有条目累加和数量更新均限制为 1 到 10；直接请求也不能绕过。
- 支付建立 `SO/Item/PU`、写入动画版本和删除购物车条目位于同一 Prisma 事务；首发关闭的旧 `CollabOrder` 分账不作为订单成立条件。
- `inventory_logs.idempotencyKey` 和 `PreOrder.checkoutIdempotencyKey` 有唯一约束，数据库基础能力已具备，只需修正键和调用方式。
- 定制草稿处于购物车时不会被 7 天清理任务误删。

## 已确认产品规则

1. 用户侧一个订单可以包含多件商品；每件实物分别生成生产/履约任务和独立生产码，同一订单中的多件商品仍可合并成一个物流包裹。
2. `CUSTOM` 与 `MARKET` 相同实体硬件已经统一按真实 SKU 汇总预留材料包库存，不能使用两套互不相关的可售数量。
3. 付款前快照负责预留库存；导出生产资料后进入生产，帧线和材料线并行；扫码记录帧包完成、材料领用、单件配对和装箱发货。退款、售后和联名成品库存仍需接入同一状态体系。
4. 联名款允许根据销售预测提前生产成品。前台不区分预制、现货或现做，只展示统一商品和可信预计发货时间；后台优先分配可用成品，缺货时自动创建现做任务。帧包或成品库存不足原则上不阻止下单，但必须触发排程、预警并调整预计交付时间。
5. 普通线上订单同一 SKU 每单默认最多 10 件，超过后引导到企业微信办理人工大宗订单；后台可创建已审核的批量订单。限量联名可另外配置按用户和活动周期计算的限购数，所有限制必须由服务端执行。
6. 未付款订单可直接取消；已付款未开工可申请取消退款。个性化定制开工后不支持无理由取消，但质量、确认内容不符或平台责任仍进入售后；标准联名款按普通实物商品规则处理。付款前必须显著确认定制例外。
7. 动画资产、动画版本、定制项目、用户订单、订单商品和单件生产任务已经分层。一次付款建立一个 `SalesOrder`；订单商品按数量展开为 `CustomizeOrder` 单件生产任务。旧直接订单路由仍待删除。
8. 用户确认的私人动画可用于以后购买其他兼容 SKU；用户可从前台删除，但后台按历史订单、售后、争议和受控留存规则保留必要内容。联名动画和商品不可由用户删除，只能下架或归档。
9. 私人帧素材包只按订单现做；获得授权的联名帧素材或成品才允许依据销售预测备货。标准材料包首版采用 SKU、批次、箱码和数量追踪，最终成品及私人帧素材包仍需绑定单件生产任务。

跨模块目标结构、编号和实施顺序见 `docs/ANIMATION_ORDER_PRODUCTION_FRAMEWORK.md`。上述内容是已确认目标，不表示现有 Schema 和 API 已完成。

## 待确认事项

1. 旧 `Animation/Product` 与 `/api/customize-orders` 已确定不属于正式首发购物路线；下一次旧代码清理需列出剩余消费者并删除无用入口。
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
