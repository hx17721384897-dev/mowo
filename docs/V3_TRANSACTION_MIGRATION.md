# V3 交易层 Vue 迁移记录

> 状态：2026-09-21 已完成 V3-0 与 V3-A；交易 DTO/ViewModel 边界已冻结，购物车、结算、订单页面尚未迁入 Vue。

## 1. 目标与边界

V3 迁移 `CUSTOM + MARKET` 混合购物车、地址选择、结算快照、订单列表和订单详情。Web 负责生成可信付款前快照并交接微信小程序，不在正式环境模拟真实收款。开发模拟支付只用于 `mowo_b1_test` 的本地验收，使测试订单能够进入后台订单、库存和生产流程。

V3 不接入真实微信支付，不修改生产状态机，也不创建第二套订单模型。现有 `PreOrder → SalesOrder → SalesOrderItem → CustomizeOrder` 是唯一交易主线。

## 2. 分段

1. **V3-0 交易证据与安全测试模式（已完成）**：冻结订单职责，建立显式隔离模拟支付启动方式并验证正式落单副作用。
2. **V3-A 交易客户端与 ViewModel（已完成）**：建立购物车、结算和订单类型白名单；统一价格、库存、地址和状态映射。
3. **V3-B 混合购物车迁移**：等价迁移数量、选择、删除、失效项和登录恢复；重复操作由服务端幂等兜底。
4. **V3-C 结算迁移**：复用 `AddressBook` 的 `select` 模式，冻结后端结算快照；正式支付关闭时只显示准确交接文案。
5. **V3-D 订单列表与详情迁移**：迁移聚合订单、商品项、生产任务、取消、收货和售后入口，并验证对象所有权。
6. **V3-E 正式入口切换与旧页删除**：逐页通过自动回归和负责人验收后，切换旧 URL、物理删除旧 HTML/专属脚本并跑完整门禁。

## 3. V3-0 隔离模拟支付模式

普通本地启动保持结算关闭：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\local.ps1 start
```

只有需要把测试订单提交到后台时，使用：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\local.ps1 start -EnableMockPayment
```

该模式强制满足：

- 数据库名严格为 `mowo_b1_test`；
- `NODE_ENV` 不能为 `production`；
- 在微信支付回调完成官方验签、商户订单和金额核对前，生产配置禁止开启 `ONLINE_CHECKOUT_ENABLED`；
- `ONLINE_CHECKOUT_ENABLED=true` 与 `MOCK_PAYMENT_ENABLED=true` 必须同时成立；
- 结算页从服务端 `/api/config/features` 读取 `mockPayment`，不因 localhost 自动显示按钮；
- 服务端再次检查开关、登录身份和预订单归属，不能只靠隐藏按钮；
- 模拟付款仍通过统一支付落单事务，不直接伪造前端成功状态。

## 4. V3-0 验证证据

- 配置负向检查通过：关闭结算、非测试数据库和 production 均拒绝启用模拟支付。
- 显式模式返回 `onlineCheckout=true`、`mockPayment=true`，结算页真实浏览器确认显示模拟支付入口；默认模式仍返回关闭。
- 隔离库完整交易回归通过：混合购物车冻结快照、幂等预订单、库存预锁、并发重复支付、聚合订单、订单商品、按数量展开生产任务、跨账号拒绝、取消与库存释放、订单列表/详情及售后状态均通过。
- 一次支付只生成一张 `SalesOrder`；重复支付不重复建单或生产任务；支付事务失败不留下不完整正式订单。
- 生产环境在线结算在真实微信回调完成验签前由启动配置强制拒绝，不能通过误设环境变量提前开放。

## 5. 人工验收

1. 确认 `local.ps1 status` 显示 `Checkout mode: isolated-mock-payment`。
2. 从 Vue 定制确认页加入购物车并进入旧结算页，选择或新增地址。
3. 点击“提交订单”；生成付款前订单后应出现绿色虚线按钮“开发模式：模拟支付成功”。
4. 点击模拟支付，页面应显示“支付成功”。
5. 使用负责人账号打开 `http://127.0.0.1:5500/mowo/frontend/pages/admin-orders.html`，新订单及按购买数量生成的生产件应可见。
6. 测试结束可切回默认关闭模式：先执行 `local.ps1 stop`，再执行不带 `-EnableMockPayment` 的 `local.ps1 start`。

## 6. V3-A 契约结论

Vue 交易模块统一位于 `frontend-vue/src/features/transaction/`：

- `types.ts` 只声明经过白名单转换后的 DTO 与页面 ViewModel，不让组件直接接收未知响应；
- `contract.ts` 负责运行时校验商品类型、购物车/预订单/订单/售后状态、金额精度、数量和时间；异常响应会受控失败，不把任意对象交给模板；
- `view-model.ts` 使用整数分计算合计，统一价格文字、购物车失效/缺货/变价状态、规格、手机号掩码和地址展示；
- `api.ts` 是购物车、结算、支付状态、隔离模拟支付、订单及售后的唯一 Vue 请求入口，页面不得自行拼接这些 URL 或解释原始响应。

服务端订单 DTO 新增 `actions`，包含 `canCancel`、`canConfirmReceipt`、`canRequestRefund`、`canRequestQuality`。这些值由生产任务真实状态计算，页面不再复制状态机；接口执行时仍重新验证状态和对象归属。聚合订单补齐 `receivedAt`，解决旧详情页读取一个服务端未返回字段的问题。

结算校验失败统一返回 `CHECKOUT_VALIDATION_FAILED` 与 `data.problems`；共享 `ApiError.details` 保留该脱敏业务详情，V3-C 可逐项提示失败商品。错误详情不包含冻结帧、收件信息或其他内部快照。

当前契约只把 `SalesOrder → SalesOrderItem → CustomizeOrder` 视为正式用户订单。服务端仍有一段仅为旧本地数据保留的无订单头兼容查询，V3-D 切换订单页面时必须连同旧用户订单兼容分支一起物理删除；外部平台订单导入和生产记录不属于该兼容分支，不删除。

## 7. V3-A 验证证据

- TypeScript 类型检查通过；交易 DTO/ViewModel 单元测试 9/9 通过，另有共享 API 错误详情测试，完整前端单测继续作为提交门禁。
- 隔离库 `check:sales-order-structure` 全部通过，覆盖混合购物车、结算幂等、库存预锁、重复/并发支付、正式订单、跨账号、取消、发货、收货和售后。
- 新增契约断言确认：已付款订单由服务端返回可取消/退款能力；全部发货后返回可确认收货；收货后返回 `receivedAt` 与质量售后能力。
- 本阶段没有切换 Vue 路由或旧 URL，没有删除交易页面，也没有修改测试账号已有购物车、草稿或人工订单。

下一步是 V3-B：按原版 DOM/CSS 和交互等价迁移混合购物车，接入本阶段唯一交易客户端；候选页验收前不切换正式入口。
