# B5 后台页面与权限矩阵

> 最后核对：2026-09-10。前端菜单/页面仅负责体验，服务端 `requiredPermissionForRequest()` 与路由命名权限才是授权边界。
>
> **后续边界（2026-09-28）：** 本表保留当时的权限取证。`admin-collab.html`、`admin-collab-policy.html`、`admin-contract.html` 及其 API 已退役，`COLLAB_ADMIN` 已删除；首发 `COLLAB` 仅用于已线下确认的联名作品与商品运营。

| 页面 | 主要端点域 | 命名权限 | 最小岗位/特殊动作 | 当前状态 |
|---|---|---|---|---|
| `admin-account-deletions.html` | `/api/admin/account-deletions` | `ACCOUNT_DELETIONS_READ/MANAGE` | 客服只读；负责人处置 | 已有隔离回归 |
| `admin-users.html` | `/api/admin/users` | `USERS_READ`、`USERS_BAN`、`STAFF_MANAGE` | 客服读/封普通用户；负责人改岗位/处理员工 | 路由命名权限及隔离回归已通过 |
| `admin-contact.html` | `/api/admin/contact` | `CONTACT`、`CONTACT_ADMIN` | 客服处理；负责人删除/封禁 IP | 路由命名权限及隔离回归已通过 |
| `admin-logs.html` | `/api/admin/logs` | `SECURITY_LOGS` | 负责人 | 路由命名权限及隔离回归已通过 |
| `admin-collab.html`、`admin-collab-works.html`、`admin-collab-product-edit.html` | `/api/admin/collab` | `COLLAB` | 合作运营、负责人 | 服务端统一权限已通过 |
| `admin-collab-activities.html` | `/api/admin/collab/activities` | `COLLAB` | 合作运营、负责人 | 运行时配置已收口 |
| `admin-collab-policy.html` | `/api/admin/collab/policy` | `COLLAB`、`COLLAB_ADMIN` | 合作运营读；负责人写 | 命名权限已通过；旧字段冲突已修复 |
| `admin-contract.html` | `/api/admin/contracts` | `COLLAB`、`COLLAB_ADMIN` | 合作运营、负责人；仅负责人删除 | 路由命名权限及隔离回归已通过 |
| Vue `/app/admin/customization-requests` | `/api/admin/customization-requests` | `CUSTOMIZATION_REVIEW` | 客服可看；生产/负责人可编辑 | V4-E1 已接管；旧工作台已删除 |
| `admin-frame-library.html` | `/api/admin/frame-library` | `FRAME_LIBRARY` | 合作运营/生产可读；负责人治理；生产可生成文件 | B6 隔离专项通过 |
| `admin-frame-making.html` | `/api/admin/frame-making` | `FRAME_MAKING` | 生产制作；负责人发布 | B6 隔离专项通过 |
| `admin-frame-imports.html` | `/api/admin/frame-imports` | `FRAME_LIBRARY` + 负责人校验 | 负责人 | B6 隔离专项通过 |
| `admin-models.html` | `/api/machine-models`、SKU mapping | `CATALOG` | 客服/负责人；写操作按路由控制 | 页面命名岗位检查与静态回归通过 |
| Vue `/app/admin/inventory` | `/api/inventory`、`/api/materials`、`/api/frame-packs` | `PRODUCTION` | 生产、负责人；帧包配置仅负责人 | V5-D7 正式接管，旧 HTML 已删除 |
| Vue `/app/admin/orders` | `/api/admin/production-workflow` | `PRODUCTION` | 生产、负责人 | V4-E2 正式接管；旧 HTML 已删除 |
| Vue `/app/admin/production-batches` | `/api/admin/production-batches` | `PRODUCTION` | 生产、负责人 | V5-A 正式接管；旧 HTML 已删除 |
| Vue `/app/admin/print-production` | `/api/admin/print-production` | `PRODUCTION_CONFIG` | 负责人 | V5-B 正式接管；旧 HTML 已删除 |
| Vue `/app/admin/import` | `/api/admin/import`、`/api/admin/sku-mapping` 当前关闭 | 路由页仅 `OWNER`/`PRODUCTION` | 生产、负责人 | V4-E3 只保留入口；服务端对所有调用者返回功能未开放 |

## 本轮已完成与仍需完成

- 已将用户、岗位、封禁、日志、联络、合同和联名政策等 B5 核心路由改为命名权限；负责人专属动作使用 `CONTACT_ADMIN`/`COLLAB_ADMIN`。
- `admin.js` 剩余数字角色主要属于旧订单、生产、导入和售后域，由 B6 在消费者确认后迁移，不在 B5 中机械替换。
- 逐岗位浏览器验证已通过：客服、合作运营、生产人员和负责人菜单均按岗位显示；4 条越权页面路径会回到首页，联名政策页对合作运营保持只读。
- B5 当前消费者与审计结论已记录在 `BATCH_5_OPERATIONS_AUDIT.md`；生产域消费者转入 `BATCH_6_ORDER_PRODUCTION_CONSUMER_MATRIX.md`。

## 消费者与审计结论

| 域 | 消费者事实 | 审计/风险结论 |
|---|---|---|
| 用户与岗位 | `admin-users.html` | 封禁、解封、岗位变更和员工处理均有明确命名权限；岗位变更会撤销旧会话。 |
| 账号注销 | `admin-account-deletions.html` | 客服只读、负责人处置；B2 已覆盖审计和隔离回归。 |
| 联络留言 | `admin-contact.html` | 客服处理与负责人删除/IP 封禁分权；不可逆动作由 `CONTACT_ADMIN` 限制。 |
| 联名政策/合同 | 联名后台页面 | 合作运营读取、负责人写入/删除；合同操作仍使用通用操作日志，字段级差异可在未来审计增强批次补齐。 |
| 帧图、导入和生产 | 对应生产后台页 | 消费者和 9 项隔离生产回归已转入 B6 清单；旧入口不能因源码仍存在而重新接入。 |
