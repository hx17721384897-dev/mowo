# V6 旧前端退役与最终验收台账

> 状态：V6-A、V6-B、V6-C1 已完成；V6-C2 自动证据已通过、负责人视觉验收待执行；V6-C3～V6-D 待执行。
> 基线：2026-10-11 的 V5 全回归已通过，但不能代替最终人工视觉、真实文件、打印和设备验收。

## 1. V6 的完成边界

V6 不是继续制作页面，而是结束新旧双轨并建立长期门禁。完成必须同时满足：

1. 每条正式 Web 流程只有 Vue 实现，旧地址只做部署层兼容跳转。
2. 无消费者的旧 HTML、页面脚本和样式物理删除；Git 历史承担追溯，不保留可运行副本。
3. 唯一暂留旧页为 `customize-editor.html` 的 `adminRequestId` 后台人工筛帧模式；用户上传、视频裁剪、图片处理和帧编辑均已由 Vue 接管。
4. 自动回归与人工验收都按正式功能矩阵执行，发现问题后修复并复跑，不以“初步看起来正常”代替证据。
5. 测试只使用 `mowo_b1_test`；响应丢失、重放和并发测试必须清理夹具，不得向日常库制造重复草稿。

## 2. V6-A 消费者审计与删除证据

### 2.1 已删除的第二套页面

| 范围 | 已删除旧实现 | 兼容去向 |
| --- | --- | --- |
| 官网 | `index`、`about`、`products`、`faq`、`user-agreement`、`privacy-policy` | `/app/`、`/app/about`、`/app/products`、`/app/faq`、`/app/legal/*` |
| 用户运营后台 | `admin-users`、`admin-account-deletions`、`admin-logs` | `/app/admin/users`、`/app/admin/account-deletions`、`/app/admin/logs` |
| 库存/生产遗留 | `production-inventory`、`_legacy/admin-production` | 前者交接 `/app/admin/inventory`；归档页不再公开 |

本地兼容服务和 Nginx 配置均保留查询参数。旧 URL 的存在只表示链接兼容，不表示保留旧实现。

### 2.2 已删除的无消费者共享文件

- `address-utils.js`：地址编辑已由 Vue 共享组件接管。
- `admin-sidebar.js`：后台菜单已统一为 `AdminSidebar.vue`。
- `feature-flags.js`：退役能力不得靠旧前端开关重新启用。
- `design-system.css`：没有运行页面引用。
- `compare-admin-b.mjs`：依赖已删除旧页面的临时几何对照脚本；历史视觉基线由固定 Git revision 的 Playwright 用例承担。

### 2.3 本轮修正的隐藏消费者

- Vue 后台侧栏的联名、用户、注销、审计入口全部改为 `RouterLink`，不再绕回旧 HTML。
- 联络留言中的“查看用户”改为 Vue 用户页并保留 `highlight` 参数。
- 后台岗位浏览器检查改为通过旧 URL 验证 302 交接后，再在 Vue 内验证菜单、移动侧栏和岗位拒绝。
- 部署门禁新增“旧文件必须不存在”和“旧目录只允许人工筛帧页”的反回流检查。

### 2.4 V6-A 自动验证结果（2026-10-11）

- ESLint + Prettier、TypeScript、生产构建、部署配置检查：通过。
- Vitest：11 个测试文件、58/58 通过。
- 用户、注销、审计、联络桌面/手机专项：30/30 通过。
- 新增旧 URL 交接门禁：桌面/手机 4/4 通过；已删除页面为 302，归档生产页为 404，人工筛帧页保持 200。
- 完整 Vue 浏览器套件：264 项中 20 项历史视觉截图按既定配置跳过；其余 244 个可执行案例均通过。首次完整运行在用户中断连接时有 4 个移动基础用例收到浏览器 `ERR_NETWORK_IO_SUSPENDED`，服务保持运行，随后同文件移动端 9/9 重跑通过。
- 真实隔离库后台岗位浏览器检查：20 项通过；测试员工由脚本在 `finally` 清理。本切片没有创建定制草稿、订单、库存或生产业务数据，因此不存在重复草稿副作用。
- 第一次在受限进程环境执行 Vitest/Vite 时出现 Windows `spawn EPERM`；在允许创建构建子进程的相同工作区重跑后全部通过，判定为执行环境限制而非代码失败。

## 3. 正式功能验收矩阵

| 领域 | 正式路由/流程 | 自动证据 | V6 人工验收重点 |
| --- | --- | --- | --- |
| 官网 | `/`、`/about`、`/products`、`/faq`、`/contact`、`/legal/*` | public/visual/contact E2E | 桌面/中宽/手机视觉、导航无抖动、协议链接 |
| 联名货架 | `/showcase`、`/showcase/:workId` | storefront E2E + API 回归 | 空/有货/下架状态、SKU、购物车交接 |
| 私人定制 | `/customize`、`/customize/editor`、`/customize/confirm` | 定制 UI/API、重复提交与私有文件回归 | 图片组、视频裁剪、完整帧编辑、返回刷新、模拟支付交接 |
| 用户中心 | `/account/settings`、`/account/customizations`、`/account/animations` | settings/customization E2E | 头像、地址复用、账号注销、素材版本 |
| 交易 | `/cart`、`/checkout`、`/orders`、`/orders/:id` | 混合购物车/订单结构/E2E | 混合商品、地址新增、库存失败、幂等、订单状态 |
| 素材与款式 | `/admin/frame-*`、`/admin/models` | 专项真实库脚本 + E2E | 批量文件夹、草稿恢复、作品/SKU 归属 |
| 联名运营 | `/admin/collab-works`、`/admin/collab-product/:id` | 联名配置与帧包回归 | 不出现线上审核/合同/违约政策入口 |
| 订单与生产 | `/admin/orders`、`/admin/production-batches`、`/admin/production-scan`、`/admin/print-production` | 生产全链路、扫码安全、打印 E2E | 空/有订单、状态转换、扫码设备、真实打印 |
| 库存 | `/admin/inventory` | 七域 22 项 E2E + 真实库回归 | 七标签隔离、写入防重、退回检查、窄屏布局 |
| 外部订单 | `/admin/import` | 门禁/入口 E2E | 仅保留说明入口，不假设平台表格模板 |
| 客服与系统 | `/admin/contact`、`/admin/users`、`/admin/account-deletions`、`/admin/logs` | 页面 E2E + 岗位浏览器检查 | 角色可见性、深链接、危险操作确认、审计脱敏 |

## 4. 后续切片

- **V6-B 数据库基线安全登记（已完成）：** 已备份并只读比较日常 `mowo_db` 与 73 份迁移参照库；确认素材记录存在，同时发现迁移账本、幂等表、字段、约束和索引差异。结论与安全迁移顺序见 `V6_DATABASE_BASELINE.md`。
- **V6-C 最终人工验收：** C1 已在 `V6_FINAL_ACCEPTANCE_PLAN.md` 固定全部合成数据、逐页步骤、接口/数据库/日志证据和清理门槛；C2～C6 将依次执行官网账户、定制交易、运营后台、生产库存和最终对账。
- **V6-D 长期门禁：** 将稳定的 lint、类型、单元、构建、部署检查、浏览器回归和退役负向矩阵接入 CI；记录真实文件、打印、扫码和支付仍需人工/设备验证的边界。

## 5. 当前不可宣告完成的事项

- 20 项历史视觉截图用例仍按配置跳过，必须人工确认或建立稳定基线后再决定启用方式。
- 后台人工筛帧仍依赖唯一旧页，只有完成等价 Vue 迁移后才能删除其 `auth.js`、`nav.js`、`private-upload.js`、`customization-review-editor.js`、`runtime-config.js` 和 `nav.css`。
- 日常库差异已经登记，但桥接迁移尚未设计和在恢复副本演练；确认素材未丢失不等于可以直接切换当前 API。
- 微信真机身份、领取和真实支付不属于本次 Web Vue 重构已完成范围。
