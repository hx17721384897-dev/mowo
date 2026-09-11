# R1 已退役能力隔离与删除台账

> 当前状态：R1-A 完成，R1-B 待 V0 功能矩阵确认后执行（最终复核：2026-09-11）
>
> 产品原则：当前版本不需要的能力不隐藏、不保留可重新开启的实现。R1-A 只是在物理删除前立即封死运行路径；R1-B 必须删除源码、静态文件、任务、配置和无保留责任的数据结构，不能把 R1-A 当作最终状态。

## 1. R1-A 已实施隔离

所有退役 URL 在最早的 `onRequest` 阶段统一返回 HTTP 404 和 `FEATURE_RETIRED`，早于认证、CORS 预检和业务路由。环境变量与公开功能配置已移除 `community`、`creatorFinance`、`bullSystem` 和 `mockCertification`，旧能力不能通过修改 `.env` 重新开启。

| 退役域 | 当前拦截路径族 |
|---|---|
| 社区 | `/api/articles*`、`/api/feed*`、`/api/users/:id/articles|follow|follow-status*`、`/api/collab/works/:id/like*` |
| 历史创作者商品 | `/api/products*`、`/api/animations*` |
| 创作者自助联名 | `/api/collab/apply*`、`/api/collab/my-works*` |
| 线上财务 | `/api/earnings*`、`/api/creator/settlement*`、`/api/admin/settlement*`、`/api/admin/revenue*`、`/api/admin/collab/activities*` |
| 牛量/推广 | `/api/creator/bull*`、`/api/admin/bull*`、`/api/creator/links*`、`/api/admin/links*` |
| 模拟认证 | `/api/certify*` |

运行时负向测试对未登录、普通用户和负责人三类调用者，逐一执行 GET、POST、PUT、PATCH、DELETE、OPTIONS。当前共验证 504 个“调用者 × 方法 × 路径”组合均返回统一 404，并比较 `Article`、`Product`、`CollabOrder`、`Balance`、`WithdrawalRequest` 计数，确认无业务副作用。

设置页已删除认证导航、认证状态、收益/牛量承诺、互动通知和“仅关注者可见”；公共导航和用户后台不再展示旧认证身份，FAQ 与产品页不再承诺社区、收藏、会员积分或“创作者变现”。私人定制草稿统一为当前用户规则，不再读取旧认证状态决定配额。合成种子也不再创建认证创作者、余额、储备金、牛量、分红活动或分红规则；售后申请不再改写旧分红状态。

## 2. 明确保留且不得误删

- 正式联名货架、商品/SKU 配置、作品权利人和授权关系。
- 人工合作合同、线下约定和必要付款凭证；它们不是线上余额/提现系统。
- 已成交订单的金额快照、售后、注销阻断和审计所需历史责任。
- 私人定制的 `/api/custom-products` 草稿、`/api/customization-requests` 申请和 `/api/animation-assets` 可复购资产。
- 当前订单、库存、生产、扫码和文件权限链。

## 3. R1-B 精确删除清单

| 层 | 待删除/改造 | 删除前必须拆出的保留依赖 |
|---|---|---|
| 路由 | `articles.js`、`feed.js`、`products.js`、`animations.js` 及 `index.js` 注册；`users.js` 的文章/关注端点；`collab.js` 的点赞、自助申请和我的作品端点；`admin-collab.js` 的活动路由 | 联名货架继续使用 `collab.js` 的公开作品接口和工作人员商品工作区 |
| 财务运行代码 | `revenue.js`；`scheduler.js` 的冷却、储备金与取消任务；`admin.js`、`orders.js`、`payment.js`、`admin-collab.js` 中的旧分红读取、计算与写入；`permissions.js` 的专用映射 | 订单成交金额、合同条款、线下付款追溯；`account-deletion.js` 在旧表删除前继续阻止带责任数据的账号注销 |
| 前端 | `_legacy/community.html`、`_legacy/favorites.html`、`_legacy/work-detail.html`、`admin-collab-activities.html`；`admin-collab.html` 和 `admin-collab-works.html` 中的自动分红/牛量展示与编辑 | 联名审核、上架、SKU、人工合同和违约政策的有效部分 |
| 配置/种子/测试 | 退役 Feature Flag、退役演示数据、旧正向测试与文案 | 保留负向 404 测试，直到源码和部署产物均确认无入口 |
| Schema/迁移 | Article/互动、余额、提现、结算、储备金、牛量/推广、模拟认证申请等无消费者结构 | 先核对注销清理、合同、订单快照、联名权利人、历史迁移外键；用新迁移删除，不改写历史 SQL |
| 文档 | 把仍写“关闭但保留/未来开开关”的当前文档改为“已退役” | 历史记录可保留，但必须明确不是当前实现或恢复方案 |

## 4. R1-B 已知阻断与顺序

1. V0 先确认外部平台订单导入是保留还是退役；R1 不自行猜测。
2. 建立 Prisma 模型、路由、注销、合同、订单与测试的依赖图。
3. 删除运行入口、专用服务和静态文件，再用新迁移清理无消费者表/字段。
4. 重放空库并运行账户、定制、联名、交易、合同、注销、库存和生产回归。
5. 扫描源码与构建产物，确保没有旧 URL、页面、Feature Flag、Scheduler 或可调用路径。

R1-B 完成后删除临时的 `retired-endpoints.js` 拦截规则；旧 URL 应因源码和注册不存在而自然返回统一 404，仓库中不能永久留下“死开关”。

## 5. 2026-09-11 文件级复核

当前仍存在且明确属于 R1-B 的独立文件为 `content-service/src/routes/articles.js`、`feed.js`、`products.js`、`animations.js`、`content-service/src/lib/revenue.js`、`frontend/pages/_legacy/community.html`、`favorites.html`、`work-detail.html` 和 `frontend/pages/admin-collab-activities.html`。此外还有上表列出的混合文件残留，不能只删除独立文件后宣告完成。

`frontend/pages/products.html` 是当前产品介绍页，不等同于历史 `/api/products` 创作者商品接口；`frontend/pages/my-animations.html` 是私人定制资产入口，不等同于历史 `/api/animations`。`admin-contract.html` 与 `contracts.js` 的分成/买断条款属于人工合作合同记录，必须保留并在 R1-B 中与线上余额、提现和自动结算彻底拆开。
