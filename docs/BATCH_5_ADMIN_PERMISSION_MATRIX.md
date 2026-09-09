# B5 后台页面与权限矩阵

> 最后核对：2026-09-09。前端菜单/页面仅负责体验，服务端 `requiredPermissionForRequest()` 与路由命名权限才是授权边界。

| 页面 | 主要端点域 | 命名权限 | 最小岗位/特殊动作 | 当前状态 |
|---|---|---|---|---|
| `admin-account-deletions.html` | `/api/admin/account-deletions` | `ACCOUNT_DELETIONS_READ/MANAGE` | 客服只读；负责人处置 | 已有隔离回归 |
| `admin-users.html` | `/api/admin/users` | `USERS_READ`、`USERS_BAN`、`STAFF_MANAGE` | 客服读/封普通用户；负责人改岗位/处理员工 | 待路由数字角色收口 |
| `admin-contact.html` | `/api/admin/contact` | `CONTACT`；敏感管理权限待命名 | 客服处理；负责人删除/封禁 IP | 待路由数字角色收口 |
| `admin-logs.html` | `/api/admin/logs` | `SECURITY_LOGS` | 负责人 | 待路由数字角色收口 |
| `admin-collab.html`、`admin-collab-works.html`、`admin-collab-product-edit.html` | `/api/admin/collab` | `COLLAB` | 合作运营、负责人 | 服务端统一权限已通过 |
| `admin-collab-activities.html` | `/api/admin/collab/activities` | `COLLAB` | 合作运营、负责人 | 运行时配置已收口 |
| `admin-collab-policy.html` | `/api/admin/collab/policy` | `COLLAB`；负责人修改 | 合作运营读；负责人写 | 负责人写仍待命名权限 |
| `admin-contract.html` | `/api/admin/contracts` | `COLLAB`；负责人删除 | 合作运营、负责人 | 待路由数字角色收口 |
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

## 仍需完成

- 将 B5 域内 `requireRole(1/2/3)` 替换为上述命名权限；旧生产域的数字角色由 B6 结合消费者处理。
- 为负责人专属的联络删除/IP 封禁、合同删除和联名政策修改建立语义明确的命名权限。
- 逐岗位浏览器验证菜单可见性、页面进入、允许动作和 403 失败提示。
