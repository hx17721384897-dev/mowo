# 项目文档有效性总表

> 最近复核：2026-10-19（RP1 当前架构与依赖图；易变数量以 `ENGINEERING_REVIEW_BASELINE.md` 为准）

> 2026-10-15 订单展示批次 A：`MOWO_ORDER_SYSTEM_REDESIGN.md`、`order-page-design/03-页面流程与实施建议.md` 与 `modules/commerce-orders-inventory.md` 已同步客户状态、接口边界和后续实施批次；其他模块仍按原复核状态。

> 2026-10-15 暂缓履约批次 B：同一订单设计稿、商品订单模块、`PRODUCTION_BATCH_WORKFLOW.md` 和 `SALES_ORDER_ACCEPTANCE.md` 已同步冻结时间、设置权限、PB 双重检查及仅测试库迁移的边界。
>
> 用途：说明每份项目 Markdown 的身份、可信范围和下一次核对动作。后续开发者或 AI 不应把“历史规划”直接当成当前代码事实。

## 使用规则

1. 当前代码事实以代码、Prisma Schema 和已执行迁移为准；文档负责解释，不反过来替代代码。
2. 产品规则以 `RELEASE_SCOPE.md`、`PROJECT_ENGINEERING_REVIEW_DECISIONS.md` 和对应业务专题为准；`OPEN_QUESTIONS.md` 逐步转为历史只读台账。
3. 历史规划可以保留用于追溯，但必须在文件开头醒目标注“历史”，并指向当前文档。
4. 旧代码和新代码同时存在时，记录在 `DOC_CODE_DIFFERENCES.md`，说明正式入口、旧入口和删除条件。
5. 完全重复、没有独立事实且已经被新版覆盖的文档可以删除；删除前要先修复所有引用。
6. 每完成一个小功能，同时更新对应模块文档、验收文档和本表状态。

## A. 当前总入口

这些文件应保持简短、准确，是理解项目时优先阅读的内容。

| 文件 | 身份 | 当前结论 |
|---|---|---|
| `../README.md` | 当前入口 | 本轮已收口为项目简介、启动方式和真实进度，不再维护旧功能长清单 |
| `PROJECT_ENGINEERING_AND_ARCHITECTURE_PLAN.md` | 已完成计划/当前 L0 基线 | B0-B7 的 L0 范围、证据、未上线边界和封版 tag |
| `PROJECT_ENGINEERING_REVIEW_PLAN.md` | 当前执行计划 | Vue 迁移后的 RP0～RP9 全栈复盘，默认只读审计后再整改 |
| `PROJECT_ENGINEERING_REVIEW_DECISIONS.md` | 当前决策台账 | 复盘新发现的产品/架构决定唯一写入位置 |
| `ENGINEERING_REVIEW_BASELINE.md` | 当前复盘基线 | RP0 的 commit、环境、范围、易变数量、订单保护和未知非功能目标 |
| `ARCHITECTURE_CURRENT_STATE.md` | 当前架构事实 | RP1 两仓库、Web/小程序/旧编辑器、API、数据库、存储、外部依赖与当前/未来边界 |
| `RP1_CONSUMER_DATA_LOG_MATRIX.md` | 当前依赖矩阵 | RP1 各领域的客户端、API、数据、文件、日志、正式/过渡/占位/退役入口 |
| `RP1_DEPENDENCY_HOTSPOTS.md` | 当前热点清单 | RP1 会话、跨仓库契约、新旧实现、领域耦合与后续处理顺序 |
| `RP1A_CUSTOMIZATION_ANIMATION_FACTS.md` | 当前专项证据 | RP1-A 定制请求、动画草稿、正式资产、文件与清理任务的代码事实和待确认规则 |
| `RP1B_RUNTIME_JOBS_FACTS.md` | 当前专项证据 | RP1-B API 运行拓扑、后台任务并发/重试/恢复、健康检查与停止边界 |
| `ENGINEERING_REVIEW_FINDINGS.md` | 当前问题台账 | 统一追踪发现、决定、整改、验证和风险接受 |
| `VUE_FRONTEND_REFACTOR_PLAN.md` | 已执行迁移计划 | L0 之后的 H0/R0/R1/V0-V6；保留未完成验收边界 |
| `R0_BACKEND_DATABASE_BASELINE.md` | 当前接续基线 | R0 复核结果、隔离命令、正式 API 边界和失败处置 |
| `R1_RETIREMENT_AUDIT.md` | 当前退役台账 | R1-A/R1-B 完成记录、物理删除范围、保留边界和回归证据 |
| `V1A_PUBLIC_SITE_MIGRATION.md` | 当前迁移记录 | V1a 公共页面、旧 URL 302、交接边界、自动验收与人工复验范围 |
| `V3_TRANSACTION_MIGRATION.md` | 当前交易迁移记录 | V3-0～V3-E 工程完成；Vue 正式入口、旧 URL 302、旧页物理删除、隔离回归和待人工视觉复查 |
| `V6_FRONTEND_RETIREMENT_AND_ACCEPTANCE.md` | 当前 V6 验收台账 | 旧前端删除证据、正式功能矩阵、唯一保留页和 V6-B～D 未完成边界 |
| `V6_DATABASE_BASELINE.md` | 当前数据库安全基线 | V6-B 只读审计、备份证据、日常库结构差异和禁止直接补迁移边界 |
| `PROJECT_INDEX.md` | 当前总索引 | 本轮更新；负责阅读顺序、代码版图和文档规则 |
| `RELEASE_SCOPE.md` | 当前产品边界 | 需在后续批次复核“当前发布事实”和上线阻断项 |
| `REMEDIATION_ROADMAP.md` | 当前整改路线 | Web 核心流程已更新；历史定制段落仍需在本轮分批收口 |
| `WEB_COMMERCE_END_TO_END.md` | 当前端到端主流程 | 当前最完整的 Web 商品、定制、交易、支付边界和生产衔接说明 |
| `OPEN_QUESTIONS.md` | 历史问题台账 | 与新决策编号建立映射后转为只读，不再新增复盘问题 |
| `DOC_CODE_DIFFERENCES.md` | 差异台账 | 需持续登记旧代码、旧页面、旧字段和删除条件 |
| `DOCUMENTATION_STATUS.md` | 文档治理台账 | 本文件；记录文档身份和复核进度 |

## B. 当前业务专题与验收记录

这些文件记录已经实现的业务逻辑或可重复执行的验收方式。后续按对应代码逐份复核。

| 文件 | 身份 | 复核状态 |
|---|---|---|
| `ACCOUNT_DELETION_POLICY.md` | 当前规则 | 已形成注销状态机；待结合正式订单再复核阻断范围 |
| `ACCOUNT_FILE_SECURITY_ACCEPTANCE.md` | 当前验收 | 保留；待正式 OSS 和恶意文件扫描完成后扩充 |
| `WEB_CUSTOMIZATION_ACCEPTANCE.md` | 当前验收 | 2026-09-08 已校正为本地混合结算/模拟付款完成，小程序领取和真实支付待办 |
| `COLLAB_STOREFRONT_REMEDIATION_PLAN.md` | 实施方案兼完成记录 | 2026-09-07 的联名货架工作基本同步，仍需最终链接扫描 |
| `ANIMATION_ORDER_PRODUCTION_FRAMEWORK.md` | 当前跨模块框架 | 待核对混合订单快照、生产文件和最新扫码状态 |
| `STANDARD_KIT_INVENTORY.md` | 当前库存规则 | 待与库存路由、流水、FIFO 和退回隔离逐项核对 |
| `PRINT_PRODUCTION_PLANNING.md` | 当前打印规则 | 待核对模板、版本、排序和生成文件实现 |
| `PRODUCTION_BATCH_WORKFLOW.md` | 当前生产规则 | 2026-09-08 已删除与现状冲突的阶段历史，保留当前批次、并行作业、扫码、返工和发货流程 |
| `PRODUCTION_WORKFLOW_ACCEPTANCE.md` | 当前验收 | 保留；后续补混合订单人工回归结果 |
| `SALES_ORDER_ACCEPTANCE.md` | 当前验收 | 待补 2026-09-07 混合结算和付款快照检查 |
| `PRODUCTION_MANUAL_TEST_PLAN_STANDARD_6SKU.md` | 当前人工测试 | 当前六规格材料包款测试基线 |
| `TROUBLESHOOTING.md` | 当前故障手册 | 保留；只记录已发生、可复现、已有解决步骤的问题 |

## C. 代码模块事实

`modules/` 下的文档用于回答“代码现在实际做什么”。本轮先校正索引，之后按模块逐份重新核对。

| 模块 | 下一次重点 |
|---|---|
| `foundation-auth-security.md` | 会话、验证码、注销限制和首发开关 |
| `staff-permissions-audit.md` | 固定岗位、后台页面权限和操作日志 |
| `private-file-security.md` | 本地/OSS、文件归属、清理和仍缺的恶意文件扫描 |
| `web-customization.md` | 2026-09-08 已复核双路线、定制草稿和动画资产建立时机；后续只随功能变化更新 |
| `animation-assets.md` | `ANM/Vn`、复购、软删除和订单版本快照 |
| `frame-asset-library.md` | 总库、批量导入、生产文件和删除/归档边界 |
| `commerce-orders-inventory.md` | 2026-09-08 已删除已修复旧风险，校正混合购物车、冻结快照、库存预留、`SO/PU` 和支付边界 |
| `collab-creator-revenue.md` | 2026-08 历史调查；顶部 2026-09-28 注记优先，当前只保留联名货架、商品运营、权利来源、库存与订单履约 |
| `content-users-contact.md` | 2026-08 历史调查；顶部 R1-B 注记优先，当前只保留用户基础能力与联络模块 |
| `admin-production.md` | 2026-09-08 已按正式 `SO/PU/PB/FP`、统一扫码工作台、返工和发货代码重写；旧入口单独列为待删除 |
| `web-frontend.md` | 历史前端消费者地图；RP0 当前旧目录仅 1 个 HTML，Vue 正式入口由 RP1/RP3 重建地图 |
| `mini-program.md` | 2026-08 历史详细调查；顶部 RP1 注记优先，当前实现与发布边界汇总到 `ARCHITECTURE_CURRENT_STATE.md` |
| `database-schema.md` | 历史数据库调查；当前 Schema/迁移数量只引用 RP0 commit 快照，待 RP5 重建领域索引 |
| `operations-quality.md` | 部署、监控、备份、压测和多实例任务 |
| `../BATCH_7_LOCAL_ACCEPTANCE_AND_RECOVERY.md` | L0 本地启动、隔离空库、综合回归、测试库恢复、人工验收和未来邀请暂停流程 |

## D. 未来方案

这些文档保留的是尚未全部上线的设计，不得写成当前能力。

| 文件 | 处理方式 |
|---|---|
| `LAUNCH_READINESS.md` | 保留为上线门槛，逐项更新完成证据 |
| `ANIMATION_DRAFT_PLAN.md` | 保留尚未实现的工程文件长期存储方案，并标注与当前 `ANM` 的边界 |
| `REVENUE.md` | 历史产品构想；旧线上分红/牛量已物理退役，不得作为恢复旧实现的方案 |
| `USER_SCENARIOS.md` | 逐个场景对照当前首发范围，删除已经废弃的承诺 |

## E. 历史或候选删除文档

这些文件不能继续充当当前事实。后续核对引用后，选择“压缩为历史说明”或删除。

| 文件 | 当前问题 | 建议 |
|---|---|---|
| `../PRODUCTION.md` | 早期生产规划，部分状态和页面已调整 | 生产操作以当前生产专题为准 |
| `API.md` | 手工长清单易与 44 个路由文件漂移 | 后续按当前路由重建，只保留稳定契约和索引 |
| `DATABASE.md` | 旧表数和早期结构与当前 Schema 并存 | 后续以带 commit/hash 的 Schema 快照重建领域索引，不手工复制全部字段 |
| `FRONTEND.md` | 静态页面数量和跳转关系已被 Vue 迁移取代 | RP3 按 Vue Router 和唯一旧编辑器重建消费者清单 |
| `admin-inventory-plan.md` | 库存重构过程稿，大量内容已落地到正式专题 | 核对独有决策后合并进 `STANDARD_KIT_INVENTORY.md`，再删除 |
| `PRODUCTION_MANUAL_TEST_PLAN.md` | 被六规格新版测试计划完整替代 | 2026-09-08 已删除，所有引用改到现行六规格方案 |
| `frontend/pages/RENAME_GUIDE.md` | 无引用的早期文件搬迁对照，包含已退役页面 | 2026-09-08 已删除 |

## 当前已确认的文档与代码差异

1. `showcase-confirm.html` 和 `showcase-confirm-v2.html` 已从正式代码删除，但多个旧文档仍有引用。
3. RP0 commit `3845931` 的 Schema 是 83 个模型、4 个枚举和 75 个迁移目录；其他数字均为历史快照。
4. RP0 当前 `frontend/` 递归扫描只有 1 个 HTML，即后台人工筛帧受控例外；Vue Router 承担正式 Web 页面。
5. Web 混合结算、冻结快照、两类商品共同预留库存和付款后生产资料已经完成；旧模块索引仍写成待整改。
6. 材料包款生产状态、批次、打印、四岗位扫码、返工和发货已经形成首轮闭环；旧模块索引仍写成待设计。
7. 私人定制自行筛帧首版不经过工作人员内容审核；旧路线图仍保留“全部定制先审核”的历史表述。

以上差异将在后续业务批次逐条落到 `DOC_CODE_DIFFERENCES.md`，并同步处理对应旧代码。
