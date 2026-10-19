# RP1_CONSUMER_DATA_LOG_MATRIX.md - 消费者、数据与日志矩阵

> 调查日期：2026-10-16
> 收口日期：2026-10-19
> 基线：主仓库 `b707536`；小程序仓库 `097d35f`
> 状态：RP1 全域矩阵完成；订单域只确认入口/依赖，业务正确性等待订单稳定 commit 后补审。

## 1. 矩阵

| 领域 | 客户端/运行消费者 | 服务端入口 | 主要数据与文件 | 日志/可观测证据 | 结论 |
|---|---|---|---|---|---|
| 认证与账号 | Vue 登录、Header、设置、后台用户/注销/日志；小程序登录/我的 | `auth-v1.js`、`account.js`、`admin.js`；旧 `auth.js` 的 me/profile | User、UserProfile、RefreshToken、SmsCode、Consent、ActionToken、AccountDeletionRequest、PrivateFile | OperationLog、AuditLog、注销状态/失败次数、进程日志 | v1 是正式 Web 契约；旧 profile 无消费者仍可达；小程序刷新链路不通 |
| 联名货架 | Vue 首页、展示、详情、后台联名作品/商品；小程序首页、详情、购物车 | `collab.js`、`admin-collab.js`、`machine-models.js` | CollabWork、SaleSku、MachineModel、Sku、FramePack、AnimationAsset/Version | 浏览/运营字段、OperationLog；完整上架状态事件待 RP7B | 首发保留；线上审核、合同和创作者财务不在当前边界 |
| 定制与动画 | Vue 开始/编辑/确认、我的定制/动画、后台定制；旧人工筛帧编辑器 | `custom-products.js`、`customization-requests.js`、`animation-assets.js`、`admin-customization-requests.js`、`upload.js` | CustomizationRequest/Event、CustomProduct、FrameSelection、AnimationAsset/Version、PrivateFile | 定制事件、OperationLog、文件状态、进程日志 | 当前双路线事实已完成专项调查；有 DTO、状态和生命周期 P1 |
| 购物车/结算/订单 | Vue 购物车、结算、订单列表/详情、后台订单；小程序当前只接购物车 Store/UI | `cart.js`、`payment.js`、`orders.js`、`addresses.js`、部分 `admin.js` | Cart/Item、PreOrder、SalesOrder/Item、CustomizeOrder、Address、SkuInventory | 库存流水、OperationLog、支付/订单日志片段 | 入口已定位；负责人正在改订单，状态/金额/幂等结论延后 |
| 库存与材料 | 后台库存、机器型号、帧包/材料操作 | `inventory.js`、`materials.js`、`frame-packs.js`、`machine-models.js` | SkuInventory、Material、MaterialLot、标准包/分装包、退回检查、库存流水/快照 | 库存流水、快照、OperationLog、进程日志 | 首发保留；状态机、FIFO、并发与数据库约束进入 RP2/RP4/RP5 |
| 生产履约 | 后台订单、生产批次、扫码、打印 | `production-batches.js`、`production-workflow.js`、`print-production.js` | SalesOrder/Item、ProductionBatch/Unit、生产帧/打印文件、领料、配对、装箱、物流 | 生产事件、库存流水、OperationLog、生成文件记录 | 正式新路由存在；旧处理器虽被 410 屏障拦截但未物理删除 |
| 联络 | Vue 联络表单、后台留言 | `contact.js`、`admin-contact.js` | ContactSubmission、PrivateFile | OperationLog、请求日志 | 首发保留；附件安全和留存进入 RP5/RP6 |
| 私有文件 | 所有上传页面、后台下载、旧编辑器、清理任务 | `upload.js` 与各业务路由的绑定/签名访问 | PrivateFile、对象键、本地目录/OSS 对象、业务绑定 | 文件状态/失败原因、OperationLog、进程日志 | “绑定”指文件关联业务对象，不是登录；长期引用和孤立文件待 RP5 |
| 外部订单 | Vue 后台占位入口 | 当前没有正式写入路由 | 尚未建立可承诺的数据映射 | 仅入口级提示 | 保留受限入口，写入关闭；取得真实样表后重新设计 |
| 后台任务 | API 启动时的 Scheduler | `scheduler.js` 及注销/文件/结算服务 | 库存快照、预订单、草稿、文件、注销、限流等 | 主要是进程日志；缺统一 run/租约/积压/告警 | RP1-B 已登记 P1/P2 |
| 维护脚本 | 工程师手工执行 | `content-service/scripts/` | 当前数据库、测试夹具、backfill 目标 | 脚本输出；并非统一审计日志 | 必须按只读/测试/写入分类，不能视为线上消费者 |

## 2. 正式、过渡、占位和退役入口

| 分类 | 当前入口 | 规则 |
|---|---|---|
| 正式 | Vue Router 页面、v1 账号接口、现行业务 API、正式生产工作流 | 按 RP2～RP7 继续复盘 |
| 受控过渡 | `customize-editor.html` | 仅后台人工筛帧；不得扩展新页面或复制新业务逻辑 |
| 受限占位 | 外部订单导入、小程序结算/订单/地址/通知/上传 | 入口存在不等于能力开放；写入和发布承诺保持关闭 |
| 已退役 | 社区、线上创作者财务/提现/牛量、线上合同/联名审核、自助创作者平台 | 当前版本不保留隐藏入口；未来按新需求重建 |
| 兼容残留 | 被 410 屏障拦截的旧订单/生产 API、旧 auth me/profile | 先完成消费者证明，再在 RP8 物理删除或替换；不能长期当“保险”保留 |

## 3. 跨域写入与事实来源

- 定制确认会同时写请求、事件、商品、动画资产/版本和文件绑定；必须作为同一领域状态机审计。
- 结算和支付会跨购物车、预订单、销售订单、库存预留和生产入口；该部分等待订单稳定后重新冻结消费者和事务图。
- 生产会读取订单冻结快照，并写批次、单件、材料/库存、文件和物流状态；不能从当前商品配置反推历史订单。
- 文件数据库记录和 OSS/本地对象是双资源系统，数据库事务不能原子覆盖物理文件；清理、补偿和人工关注必须共同证明最终一致。
- 全局 OperationLog、领域事件和进程日志各有不同用途，任何一个都不能单独证明完整业务链路。

## 4. RP2/RP4 的补审入口

1. 订单稳定后补画 Cart -> PreOrder -> Payment -> SalesOrder -> Inventory -> Production 的事务和状态变化图。
2. RP2 为定制、动画、联名上/下架、库存、生产、注销和文件清理建立唯一状态机。
3. RP4 对所有跨表写入核查事务、幂等键、并发抢占、响应 DTO 和事务外副作用。
4. RP7B 对每个核心动作确认“谁、何时、对象、前后状态、结果、失败原因、请求 ID、告警责任人”。
