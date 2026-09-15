# R0 后端与数据库接续基线

> 状态：完成（2026-09-10）
>
> 范围：只证明当前 Web/Vue 工作可以在隔离本地环境消费既有后端；不代表能够邀请真实用户、处理真实附件、收款或上线。
>
> R1-B 后续注记（2026-09-14）：本文件的 59 份迁移与 504 种隔离调用是 R0/R1-A 历史基线。当前终态为 60 份迁移、已退役能力无路由、完整 B7 与备份恢复通过；见 `R1_RETIREMENT_AUDIT.md`。

## 1. 可重复入口

在 `content-service/` 执行：

```powershell
npm ci
npm run check
npm run test-db:rebuild
npm run check:b7
```

项目根目录的本地服务入口：

```powershell
pwsh -File scripts/local.ps1 start
pwsh -File scripts/local.ps1 status
pwsh -File scripts/local.ps1 stop
```

`test-db:rebuild`、写库专项和 B7 综合入口都通过 `test-db-guard.mjs` 强制数据库名严格等于 `mowo_b1_test`。不得把这些命令改指向 `mowo_db`，也不得用旧开发库替代空库迁移证据。

## 2. 2026-09-10 复核结果

| 项目 | 当前证据 |
|---|---|
| Schema | 111 个 model、4 个 enum；`prisma validate` 通过 |
| 迁移 | 59/59 从空的 `mowo_b1_test` 完整重放 |
| 合成种子 | 5 个账号、2 个机型、8 个 SKU；不再创建认证创作者、余额、储备金、牛量、分红活动或分红规则 |
| 静态检查 | 环境、115 个 JavaScript 文件语法和 Prisma Schema 通过 |
| 综合回归 | B7 的 33 项入口包含账户、私有文件、定制、交易、库存、后台权限、生产、扫码、联名货架和退役接口 504 种负向调用 |
| 恢复 | `pg_dump`、删除重建、`pg_restore`、迁移状态和数据指纹已有自动演练 |

## 3. Vue 可消费的后端边界

| 领域 | 正式 API 边界 | 权限/数据结论 | 主要回归证据 |
|---|---|---|---|
| 账户 | `/api/v1/auth/*`、`/api/v1/account/*`、`/api/addresses/*` | 会话与对象归属由后端验证；前端权限只做体验控制 | `check:staff-security`、`check:settings-ui`、`check:account-deletion` |
| 私人定制 | `/api/custom-products/*`、`/api/customization-requests/*`、`/api/animation-assets/*` | 草稿、正式申请、动画资产与版本分离；私有文件使用受控短期地址 | `check:private-files`、`check:customization-flow`、`check:customization-ui` |
| 联名货架 | `/api/collab/works*`；工作人员使用 `/api/admin/collab/*` 的保留商品工作区 | 公开响应使用字段白名单；历史 `/api/products`、`/api/animations` 不得消费 | `check:collab-storefront`、`check:collab-sale-config`、Vue V1b unit/E2E |
| 交易订单 | `/api/cart/*`、`/api/orders/*`；支付入口当前受 `ONLINE_CHECKOUT_ENABLED` 阻断 | 价格和库存以服务端冻结快照为准；重复提交依靠服务端幂等 | `check:sales-order-structure`、`check:mixed-checkout-ui` |
| 库存生产 | `/api/inventory/*`、`/api/materials/*`、`/api/admin/production-*`、`/api/admin/frame-*` | 岗位权限、库存事务和扫码幂等由后端执行 | 9 个生产/库存专项与 `check:staff-security` |

详细字段契约仍以路由 Schema、契约脚本和 DTO fixture 为唯一事实源。当前并非每个响应都已有完整 JSON Schema；V0 只能冻结将要迁移的正式 API，不得根据历史 `API.md` 猜字段。

## 4. 明确不属于 R0 完成的内容

- 微信身份、一次性订单领取、真实支付验签、退款和对账。
- 真实附件的恶意文件扫描、正式域名/CORS、线上监控与告警。
- CI、服务器部署、线上备份恢复和真实用户数据治理。
- 已退役旧表的物理删除；该工作属于 R1-B 的依赖与迁移专项。
- `production-inventory.html` 与售后最小后台闭环的产品决定。

## 5. 漂移和失败处理

如果迁移、Schema、种子或核心检查发生漂移：立即停止对应 Vue 领域迁移，在新的隔离测试库修复并重新运行完整 R0/B7；不得直接修改 `mowo_db`，不得改写已经提交的历史迁移来制造通过结果。测试进程中断后先检查 3002/5500 端口、Git 状态和测试库状态，再决定重跑范围。
