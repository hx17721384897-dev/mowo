# mowo 当前架构

## 系统组成

| 部分 | 技术与职责 |
|---|---|
| Web 前端 | `frontend-vue/`，Vue 3 + TypeScript。展示商品、私人定制、联名、购物车、订单以及员工后台。 |
| API 服务 | `content-service/`，Node.js + Fastify。执行身份、商品、结算、库存、订单、售后和生产规则。 |
| 数据库 | PostgreSQL，由 Prisma 访问。商品、客户、交易和生产业务数据均在 mowo 的模型中管理。 |
| 文件 | 私有上传与预览经 API 授权；正式对象存储按私有文件规则配置。 |
| 小程序 | 同级 `xiaochengxu/` 工程，计划承接微信身份、订单确认与官方支付；实际开放范围以发布验收为准。 |

## 订单与生产数据流

```text
私人定制／联名商品
  → mowo 购物车与结算快照
  → PreOrder：付款前凭据和库存预留
  → 服务端核实支付事实
  → SalesOrder：客户总订单
  → SalesOrderItem：商品及成交快照
  → PU：按实物件数展开的生产任务
  → PB／FP／材料／配对／装箱／发货
  → 我的订单读取真实进度
```

商品规格、价格、客户归属、库存和订单只有 mowo 一个业务写入来源。结算不能只相信前端提交的金额；订单详情和操作必须在 API 校验顾客身份与服务端资格。生产批次与逐件任务的实际状态由生产流程写入，顾客页面只读取并汇总。

付款后暂缓履约、订单状态、客户与商家页面设计见 [`MOWO_ORDER_SYSTEM_REDESIGN.md`](MOWO_ORDER_SYSTEM_REDESIGN.md)。当前生产细节见 [`PRODUCTION_BATCH_WORKFLOW.md`](PRODUCTION_BATCH_WORKFLOW.md)；完整交易链路见 [`WEB_COMMERCE_END_TO_END.md`](WEB_COMMERCE_END_TO_END.md)。

## 部署与安全边界

- 开发环境的模拟付款只用于隔离测试；生产收款须完成微信支付通知验签、金额核对、主动查单、退款和对账。
- 订单、库存与生产写入要有幂等键、数据库约束、事务和操作审计。跨进程失败要可查询、可重试。
- 私有动画和收件信息只能由本人或有权限的员工读取；页面隐藏按钮不代替服务端鉴权。
- 上线前核对环境变量、备份恢复、监控告警、压测及发布回退步骤。当前部署完成度见 [`LAUNCH_READINESS.md`](LAUNCH_READINESS.md)。
