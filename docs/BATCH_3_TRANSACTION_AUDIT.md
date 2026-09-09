# 批次 3：用户交易层审计台账

> 启动日期：2026-09-09  
> 目标：在真实线上支付继续关闭的前提下，收敛购物车、结算快照、订单、库存预留及售后入口，使本地邀请测试能够安全展示“可结算”边界而不形成伪造付款或双轨订单。  
> 边界：`ONLINE_CHECKOUT_ENABLED=false` 必须继续由服务端拒绝 `/api/cart/checkout` 和全部 `/api/payment/*`。本批次不启用真实支付、不接入支付供应商，也不修改 `mowo_db`。

## 1. 执行顺序和状态

| 编号 | 子任务 | 当前状态 | 验收证据 |
|---|---|---|---|
| B3-A | 交易页面运行时配置与入口 | 首轮收敛完成：四页已统一运行时 API Origin | 静态扫描、浏览器登录/跳转、同源部署契约 |
| B3-B | 购物车 DTO、所有权与价格/库存状态 | 未开始 | 双账号、价格变动、库存不足、幂等加购 |
| B3-C | 结算快照、预订单与库存预留 | 未开始 | 幂等、原子预留、过期释放、跨账号边界 |
| B3-D | 支付关闭边界与未来回调隔离 | 当前关闭边界实测通过；真实支付实现未开始 | 功能闸门、匿名拒绝、不得伪造支付 |
| B3-E | 用户订单、取消、收货、售后 | 未开始 | 状态机、订单所有权、文件/员工权限 |
| B3-F | 批次验收与文档收口 | 未开始 | 专项检查、浏览器回归、遗留风险 |

## 2. B3 初始事实

| 范围 | 代码事实 | 当前判断 |
|---|---|---|
| 购物车 | `routes/cart.js` 以当前 `userId` 获取唯一购物车；加购要求 `itemType`、`contentId`、`hardwareSkuId`，结算在事务内创建带冻结快照的 `PreOrder` 并预留库存。 | 正式 B3 核心，需逐端点验证所有权、价格变动和库存释放。 |
| 付款 | `routes/payment.js` 保留 mock 回调/正式订单建单逻辑，回调本身尚无支付供应商验签。 | **不得开启。** 全局功能闸门应在路由处理前拒绝结算和全部付款路径。 |
| 订单 | `routes/orders.js` 是用户订单、确认收货、取消与售后入口；`SalesOrder`、`SalesOrderItem`、`CustomizeOrder` 分别承担总订单、成交快照与单件生产任务。 | 正式 B3 核心，需核对状态机和数据所有权。 |
| 前端 | `cart.html`、`checkout.html`、`orders.html`、`order-detail.html` 有独立 API Origin 和认证请求实现。 | 与 B2 的会话/API Origin 漂移同类，先统一运行时 API 配置。 |

## 3. 已发现问题与决策

| 编号 | 事实 | 风险 | 后续动作 |
|---|---|---|---|
| B3-001 | `cart.html`、`checkout.html`、`orders.html`、`order-detail.html` 仍把 API 写死为 `localhost:3001` 或以 `127.0.0.1` 二分。 | 部署后交易页请求访问者本机，购物车、订单与售后不可用；会话/Origin 配置再次漂移。 | 迁移至 `runtime-config.js` + `window.MOWO_API_BASE`，再做静态扫描和本机页面验证。 |
| B3-002 | `payment.js` 的回调逻辑仍是预留 mock，未实现支付签名、商户订单和金额来源验证。 | 若付款开关被误开，存在伪造付款建单风险。 | 当前服务端功能闸门覆盖 `/api/cart/checkout` 与 `/api/payment/*`，本批次要实际验证拒绝行为；真实支付另列 C 阶段。 |
| B3-003 | 前端结算页包含仅本机显示的 mock 支付入口。 | 误将本地模拟付款叙事带入邀请体验，或与服务端关闭开关不一致。 | 核对开关读取、页面文案和所有跳转；未启用支付前不应给用户可完成付款的假承诺。 |

### B3-A/B3-D 首轮验证（2026-09-09）

- `cart.html`、`checkout.html`、`orders.html`、`order-detail.html` 均在业务脚本之前加载 `runtime-config.js`，并以 `window.MOWO_API_BASE || ''` 取 API Origin。本机保留 `localhost:3001`，部署默认同源 `/api`。
- 对四页的定向扫描已无 `localhost:3001` 或 `127.0.0.1:3001` 遗留；本机静态 URL 均返回 HTTP 200。
- 当前 API 配置中 `onlineCheckout=false`。实际匿名 `POST /api/cart/checkout` 与 `POST /api/payment/callback` 均返回 HTTP 404 和 `FEATURE_NOT_AVAILABLE`，证明付款回调未因其内部 mock 代码而被误开放。

## 4. 当前规则

- 所有会写入数据的 B3 专项检查必须在启动前验证 `DATABASE_URL` 为 `mowo_b1_test`；不得复用会写入的检查直接指向 `mowo_db`。
- 付款关闭不是“前端隐藏”：应以实际 HTTP 404 `FEATURE_NOT_AVAILABLE` 为服务端证据。
- 交易状态、价格、库存和订单快照只能以服务端事务为事实源；前端缓存、URL 参数和历史 `CustomizeOrder` 字段不能成为结算依据。
- 每一个前端运行时配置改动都必须扫描硬编码 Origin，且不能破坏本机 `localhost:3001` 验收。
