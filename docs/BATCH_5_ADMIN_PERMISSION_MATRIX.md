# B5 后台页面与权限矩阵

> 最后核对：2026-09-09。前端菜单/页面仅负责体验，服务端 `requiredPermissionForRequest()` 与路由命名权限才是授权边界。

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
| `admin-customization-requests.html` | `/api/admin/customization-requests` | `CUSTOMIZATION_REVIEW` | 客服可看；生产/负责人可编辑 | B2 流程回归已通过 |
| `admin-frame-library.html` | `/api/admin/frame-library` | `FRAME_LIBRARY` | 合作运营/生产可读；负责人治理；生产可生成文件 | B6 继续副作用回归 |
| `admin-frame-making.html` | `/api/admin/frame-making` | `FRAME_MAKING` | 生产制作；负责人发布 | B6 继续副作用回归 |
| `admin-frame-imports.html` | `/api/admin/frame-imports` | `FRAME_LIBRARY` + 负责人校验 | 负责人 | B6 继续导入回归 |
| `admin-models.html` | `/api/machine-models`、SKU mapping | `CATALOG` | 客服/负责人；写操作按路由控制 | 待浏览器回归 |
| `admin-inventory.html` | `/api/inventory`、`/api/materials` | `PRODUCTION` | 生产、负责人 | 当前岗位读取已收口 |
| `admin-orders.html` | `/api/admin/production-workflow` | `PRODUCTION` | 生产、负责人 | 正式工作流结构检查通过 |
| `admin-production-batches.html` | `/api/admin/production-batches` | `PRODUCTION` | 生产、负责人 | B6 专项待重跑 |
| `admin-print-production.html` | `/api/admin/print-production` | `PRODUCTION_CONFIG` | 负责人 | B6 专项待重跑 |
| `admin-import.html` | `/api/admin/import` | `PRODUCTION` | 生产、负责人 | 旧/新导入消费者待 B6 核对 |

## 本轮已完成与仍需完成

- 已将用户、岗位、封禁、日志、联络、合同和联名政策等 B5 核心路由改为命名权限；负责人专属动作使用 `CONTACT_ADMIN`/`COLLAB_ADMIN`。
- `admin.js` 剩余数字角色主要属于旧订单、生产、导入和售后域，由 B6 在消费者确认后迁移，不在 B5 中机械替换。
- 逐岗位浏览器验证菜单可见性、页面进入、允许动作和 403 失败提示。
- 继续补齐不可逆动作的审计字段与消费者记录。
