# 动画资产与不可变版本

> 首版实施日期：2026-08-21；复购入口完成日期：2026-08-21。本文件记录当前代码已经实现的动画资产基础。跨订单和生产的目标设计见 `../ANIMATION_ORDER_PRODUCTION_FRAMEWORK.md`。

## 简单说明

动画资产代表一套可以重复使用的核心动画；动画版本代表用户某次最终确认的帧图结果。它们都不是定制申请、SKU、订单或生产任务。

自己筛帧的用户在确认款式并提交订单流程时生成资产版本；人工筛帧的用户在点击“满意，选择款式”时生成资产版本。两个动作都和原定制状态变化放在同一个数据库事务中，不会出现定制已确认但资产没有保存的半完成状态。

## 当前数据模型

| 模型 | 作用 | 关键规则 |
|---|---|---|
| `AnimationAsset` | 可复购动画主记录 | 独立 `ANM-YYYYMMDD-XXXXXX` 编号；记录所有人、来源、私人/联名、前台删除和当前版本号 |
| `AnimationAssetVersion` | 不可覆盖的核心帧版本 | 每资产从 V1 递增；保存有序私有文件 key、基础帧数、编辑数据和清单哈希 |
| `CustomizationRequest` | 一次定制过程 | 新增 `animationAssetId` 和 `acceptedAnimationVersionId`，仍使用独立 `DZ` 编号 |
| `CustomProduct` | 旧编辑器草稿和当前购物车载体 | 新增资产/版本关联用于兼容；不再等同于正式动画资产 |
| `CustomizationFrameSelection` | 员工筛帧版本 | 被用户接受的版本可作为动画版本来源；未接受或被替换的版本不会进入动画资产 |

数据库内部继续使用 UUID。公开业务编号不能用来绕过登录或换取私有文件地址。

迁移文件为 `prisma/migrations/20260821150000_add_animation_assets_and_versions/migration.sql`。本地库因历史迁移账本未建立，使用 `prisma db execute` 单独应用了本次增量 SQL，没有重跑旧迁移。

## 版本生成规则

### 自己筛帧

`POST /api/customization-requests/:id/submit` 在把 `DRAFT` 改为 `CONFIRMED` 的同一事务中：

1. 再次验证款式和帧图；
2. 创建 `SELF_SCREENED` 动画资产及 V1；
3. 把资产/版本关联回定制申请和 `CustomProduct`；
4. 取消该 `CustomProduct` 的七天草稿到期时间；
5. 时间线记录资产和版本内部 ID。

来源键为 `CUSTOMIZATION_REQUEST:<requestId>:SELF_CONFIRMED`，具有唯一约束，网络重试不会重复建版本。

### 人工筛帧

`POST /api/customization-requests/mine/:id/frame-selection/accept` 在用户接受员工结果的同一事务中：

1. 只接受当前 `SUBMITTED` 筛帧版本；
2. 创建 `STAFF_SCREENED` 动画资产及 V1；
3. 记录员工筛帧版本、定制申请、`CustomProduct` 和创建员工；
4. 将定制状态改为 `FRAME_ACCEPTED`；
5. 后续选 SKU 只改变定制流程，不覆盖动画版本。

来源键为 `CUSTOMIZATION_FRAME_SELECTION:<selectionId>`。并发重复点击只会成功确认一次，第二次返回已经完成的原结果。

## 内容完整性

- 生成版本前，后端确认每个核心帧都处于 `READY`、未删除且归资产所有人所有。
- 版本保存帧图顺序；同一组图片采用不同顺序会产生不同的版本清单。
- `manifestHash` 使用每帧文件 SHA-256、顺序和编辑数据计算，用于以后锁定订单和打印输入。
- 当前版本没有更新接口。重新编辑功能接入时必须创建 V2、V3，不能修改 V1。
- 私有文件继续绑定原始定制草稿或员工筛帧版本；动画版本只保存经过验证的引用，不改变现有定制读取权限。

## 用户接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/animation-assets` | 分页列出当前用户未删除的正式动画资产和当前版本预览 |
| GET | `/api/animation-assets/:id` | 查看自己的资产及全部不可变版本，帧图地址有效 30 分钟 |
| PATCH | `/api/animation-assets/:id` | 只修改资产名称，不修改版本内容 |
| POST | `/api/animation-assets/:id/reuse` | 锁定当前动画版本，选择兼容 SKU 后创建新的 `DZ` 记录和购买载体 |
| DELETE | `/api/animation-assets/:id` | 私人资产前台软删除；后台版本和文件不物理删除 |

其他用户读取返回 404，避免额外泄露资产是否存在。联名资产或处于合作状态的资产不能通过普通用户删除接口删除。

## 页面行为

`frontend/pages/my-animations.html` 同时请求正式资产和旧草稿：

- “动画资产”显示 `ANM` 编号、当前 V 版本和长期预览；
- “草稿”只显示尚未关联正式资产的 `CustomProduct` 和剩余有效期；
- 正式资产显示明确的“重命名”操作并调用资产接口；草稿重命名继续使用草稿接口；
- 正式资产删除后从前台消失，但不会删除后端版本；
- 正式资产显示“选择新款式”。进入 `customize-start.html?assetId=...` 后只展示至少有一个兼容 SKU 的在售款式，再进入规格页和结算。

复购不会复制帧文件，也不会创建 V2。后端创建新的 `CustomProduct` 作为本次购物车载体，并生成新的 `DZ` 定制记录；两者都锁定原 `animationAssetId + animationVersionId`。基础兼容条件为 `SKU 目标帧数 % 动画基础帧数 == 0`，最终价格仍只读取服务端 SKU，不信任网页提交的参考价格。

复购接口使用浏览器随机提交键防止重复点击创建两份 `DZ` 记录；他人访问资产统一返回 404，前台已删除资产、素材不完整、停用 SKU 和帧数不兼容均不能复购。

`my-customizations.html` 仍负责定制流程和状态，两页没有混用同一种数据。

## 旧数据兼容

`npm run assets:backfill` 会扫描已经达到 `FRAME_ACCEPTED`、`STYLE_SELECTED` 或 `CONFIRMED` 且没有资产关联的定制记录，根据已接受员工版本或自己筛帧结果补建资产。脚本可重复运行，来源键唯一，不会重复创建。

2026-08-21 已对本地库执行一次，成功补建 2 套既有动画资产，跳过 0 条。

## 自动验证

- `npm run check`：环境、JavaScript 语法和 Prisma Schema。
- `npm run check:customization-flow`：验证两条来源、编号、单版本、并发幂等、跨账号隔离、重命名、联名删除拦截、私人前台删除后后台版本保留，以及复购不新增版本、非法复购拦截和购物车接入。
- `npm run check:customization-ui`：真实 Edge 验证“我的动画”区分正式资产与临时草稿、重命名、选择兼容款式并进入结算。

曾出现“重命名弹窗正常，但保存后名称不变”：原因是 CORS 允许方法遗漏 `PATCH`，浏览器只完成 `OPTIONS` 预检，没有发送真正的修改请求。`src/index.js` 现已允许 `PATCH`。类似现象应先在浏览器网络面板检查是否只有 `OPTIONS` 而没有后续请求。

浏览器测试会清理本轮及历史标记为 `custom-ui-test` 的临时账号、资产和私有文件。

## 当前明确未完成

1. 用户重新编辑后创建 V2，以及查看和选择历史版本。
2. 创作者/员工代录动画、私人动画申请联名和联名授权状态流转。
3. 正式订单商品直接锁定 `animationVersionId`、SKU 和打印模板快照；当前锁定已到定制记录与购物车载体。
4. 正式 OSS、恶意文件扫描、备份恢复及后台留存期限。

这些内容不得通过修改现有 V1 或重新混用 `CustomProduct` 实现。
