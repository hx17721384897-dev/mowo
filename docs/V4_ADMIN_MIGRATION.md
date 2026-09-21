# V4 后台运营层迁移记录

> 状态：2026-09-21 启动 V4-0 证据与路由边界；尚无后台业务页迁入 Vue。旧后台仍为正式操作入口，不能把 Vue 占位壳当成可用后台。

## V4-0 现状与边界

- 当前 `frontend/pages/` 有 19 个现行 `admin-*.html`，另有 `_legacy/admin-production.html`。V0 台账中的“24 页”为历史快照，不能据此删除或补造页面。
- Vue `/app/admin` 在本批次前仅为占位布局，且未要求登录。现要求实时 `/api/v1/account/me` 确认登录与四种命名岗位后才能进入；普通账号或只有旧数字角色、未由服务器返回 `staffRole` 的账号进入 403。它只是体验门禁，所有数据和动作仍由后端权限 Hook 与业务路由守卫决定。
- 父路由只确认员工身份。将来的每个子路由还须声明允许岗位；父子规则取交集，不能因为父路由允许四岗位而放宽子页面。首次迁移前不得从旧页导航切到占位壳。
- V3 订单人工验收因为本地暂无订单而延后；不创建虚假订单、不把它记作已验收。

## 页面—岗位—接口初始矩阵

以下是迁移切片划分，不是把同组页面视为拥有相同操作权限。服务端事实源为 `content-service/src/lib/permissions.js` 的 `requiredPermissionForRequest` 和各路由的 `preHandler`；页面脚本可作为差异证据，不可替代服务端检查。

| 切片 | 当前页面 | 主要权限点与岗位 | 首批关注的危险/私有数据 |
|---|---|---|---|
| V4-A 运营联络 | `admin-contact` | `CONTACT`：负责人、运营客服；删除/封禁 IP 为仅负责人 `CONTACT_ADMIN` | 留言联系人、IP、私有附件、备注、状态与删除审计 |
| V4-B 用户与注销 | `admin-users`、`admin-account-deletions`、`admin-logs` | `USERS_READ`/`USERS_BAN`、`ACCOUNT_DELETIONS_READ`/`MANAGE`、`STAFF_MANAGE`、`SECURITY_LOGS` 分开判定 | 手机脱敏、岗位更改、封禁、注销恢复、安全日志 |
| V4-C 联名与合同 | `admin-collab`、`admin-collab-works`、`admin-collab-product-edit`、`admin-collab-policy`、`admin-contract` | `COLLAB` 与仅负责人 `COLLAB_ADMIN` 分开 | 合同私有文件、上架/归档、违约政策、删除 |
| V4-D 商品与帧图 | `admin-models`、`admin-frame-library`、`admin-frame-making`、`admin-frame-imports` | `CATALOG`、`FRAME_LIBRARY`、`FRAME_MAKING`；具体操作需再核对路由 | SKU 与机型修改、私有帧图、导入、归档 |
| V4-E 定制/订单/外部导入 | `admin-customization-requests`、`admin-orders`、`admin-import` | `CUSTOMIZATION_REVIEW`、`ORDER_SUPPORT`、`PRODUCTION` 当前分别保护；需逐端点核对 | 人工筛帧、用户地址、订单状态、外部订单导入幂等 |
| V5 交接 | `admin-inventory`、`admin-production-batches`、`admin-print-production` | 库存与生产权限；打印设置有更窄的 `PRODUCTION_CONFIG` | 库存流水、物料扣减、生产状态 |

### 迁移前必须收敛的差异

1. 外部订单导入是已确认保留功能，但历史产品文档把合作运营也列为可导入岗位；当前 `admin-import.html` 和 `/api/admin/import` 实际只允许负责人/生产岗位。V4-E 前须由负责人确认是否扩大权限，不能仅修改 Vue 菜单。
2. `admin-orders.html` 的旧页面只允许负责人/生产岗位，而后端通用 `ORDER_SUPPORT` 权限还包含运营客服。订单切片必须明确客服的允许视图和字段，避免 Vue 放宽旧页面或泄露收件信息。
3. 服务端 `effectiveStaffRole` 对旧数字 `role` 仍有兼容映射。Vue 不自行推断数字角色，但服务端 `/me` 是否继续返回兼容映射需要在岗位专项中统一决定；迁移期间不能产生第二份前端权限事实源。
4. `production-inventory.html` 的两个旧只读消费者，以及售后后台最小闭环仍是产品决策门槛；不影响先迁 V4-A 联络，但相关切片动工前必须确认。

## 分段执行与验收

V4-0 冻结入口、现行页面和差异；V4-A 先迁联络留言（旧页功能/布局逐项对照，保持旧页直到负责人验收）；之后按上表切片迁移。每个切片都要有当前岗位正向、至少一个无权岗位负向、匿名负向、私有字段隔离、写入后刷新事实、失败反馈和旧 URL 退役证据。删除/归档/上架、权限修改等高风险操作显示影响并依赖服务端审计结果。V5 交接项不在 V4 中提前删除。

V4-0 自动回归：TypeScript、生产构建、55/55 单元测试、本次改动文件的 ESLint/Prettier、桌面/手机后台门禁及基础路由 30/30 通过。全仓 `npm run lint` 的 ESLint 为 0 错误、146 条已有 Vue 模板风格警告；随后 Prettier 因未修改的 `tests/e2e/orders.spec.ts` 格式问题返回失败，已单独隔离验证本次文件，不把全仓门禁记作通过。浏览器测试时 API 3001 为停止状态，公开首页的联名列表代理请求出现连接拒绝；所测后台路由使用明确的 `/me` fixture，30 项全部通过，这不是服务端岗位 API 的重新验收。测试结束已恢复原先的 `mowo_b1_test` 隔离模拟支付三服务。此处不声称旧后台已迁移或全部岗位 API 已通过。
