# PROJECT_INDEX.md - 项目知识库入口

> 目标：让新加入的开发者或 AI 先读少量入口文档，再按业务域深入，不必重新猜测代码结构。
>
> 调查基准：2026-08-13，进度更新：2026-08-23。本文档区分“已核对代码事实”“原规划”“待确认”，不把规划自动视为已实现。

> 当前进度：账号与文件安全已完成；Web 定制、动画资产复购/V2、聚合订单 `SO` 与单件生产任务 `PU` 已建立。库存已实现散装零件、分装小包、标准材料包、FIFO 批次和退回隔离。材料包款生产批次第一阶段已完成：后台可按完整 `SO` 创建 `PB`、检查生产条件、记录库存提醒并查看每个 `PU` 的四条并行进度。下一阶段优先实现材料领料任务、帧素材任务和逐件配对；打印裁切配置、异常返工和打包发货仍需分阶段确认。公开上线前的正式 OSS、恶意文件扫描、法律文本、备份恢复、监控与压测仍未完成。

## 建议阅读顺序

1. `README.md`：产品定位、启动方式和最短项目简介。
2. `docs/PROJECT_INDEX.md`：项目地图、文档分层和调查进度。
3. `docs/RELEASE_SCOPE.md`：当前发布阶段、首发开放/关闭能力和延后讨论边界。
4. `docs/REMEDIATION_ROADMAP.md`：按功能区划分的实际代码整改顺序、边界和验收标准。
5. `CLAUDE.md`：开发约束、合规边界、角色规则和协作规范；其中历史进度或旧架构描述不覆盖 `RELEASE_SCOPE.md`。
6. `docs/LAUNCH_READINESS.md`：B/C/D 阶段门槛、R0-R4 工程就绪等级、复杂度和责任域。
7. `docs/modules/README.md`：按代码模块进入详细说明。
   员工岗位与安全记录见 `docs/modules/staff-permissions-audit.md`；本地/OSS私有上传与文件权限见 `docs/modules/private-file-security.md`；Web 定制首批事实见 `docs/modules/web-customization.md`。
8. `docs/DOC_CODE_DIFFERENCES.md`：文档与代码不一致、风险和过渡状态。
9. `docs/OPEN_QUESTIONS.md`：待确认问题，以及已从问题台账收敛出的阶段性产品决策。
10. `docs/ACCOUNT_DELETION_POLICY.md`：账号注销的法规参考、建议规则和数据处理边界。
11. `docs/ACCOUNT_FILE_SECURITY_ACCEPTANCE.md`：账号、权限、文件、注销与首发安全的人工验收步骤。
12. `docs/WEB_CUSTOMIZATION_ACCEPTANCE.md`：Web 定制首批的人工验收步骤与延后边界。
13. `docs/TROUBLESHOOTING.md`：本地开发已经发生过的故障、识别方法和修复边界。
14. 对应业务规划：`PRODUCTION.md`、`REVENUE.md`、`docs/USER_SCENARIOS.md` 等。
15. `docs/ANIMATION_ORDER_PRODUCTION_FRAMEWORK.md`：动画资产、版本、订单商品、单件生产和材料追踪的已确认目标框架。
16. `docs/STANDARD_KIT_INVENTORY.md`：三层库存、FIFO批次追溯、SKU材料清单、标准材料包组装、退回隔离检查和补发任务的当前实现。
17. `docs/PRODUCTION_BATCH_WORKFLOW.md`：材料包款生产批次、帧素材与材料并行作业、阶段边界和验收记录。

## 文档分层

| 层级 | 作用 | 内容边界 |
|---|---|---|
| 根目录文档 | 项目入口与长期业务规则 | 简要、稳定、避免堆积逐文件细节 |
| `docs/` | 发布范围、上线准备、跨模块架构、数据库、API、前端、差异与问题 | 面向全项目的主题文档 |
| `docs/modules/` | 代码事实 | 每个业务域的入口、依赖、数据表、接口、前端消费者和已知问题 |
| 源码旁注释 | 解释局部复杂实现 | 不承担项目级设计记录 |

## 当前代码版图

### 主仓库 `mowo/`

- `frontend/`：纯 HTML、CSS、原生 JavaScript 主站，包含公共页面、定制流程、用户中心、创作者中心、管理后台和生产端页面。
- `content-service/`：Node.js ESM + Fastify 5 API 服务，Prisma 5 访问 PostgreSQL；本地开发使用私有目录保存测试文件，正式环境计划使用私有阿里云 OSS。
- `crmeb/`：当前只有 `.gitkeep` 占位文件，没有外部商城代码；早期规划曾拟接 CRMEB，首发已决定不接入。
- `docs/`：架构、接口、数据库、前端清单、用户场景和专项计划。

### 主仓库外的同级目录 `xiaochengxu/`

- uni-app + Vue 3 + TypeScript + Pinia + Vite 小程序工程。
- 当前不属于 `mowo/.git` 管理范围，但与主项目共用业务概念和后端接口，因此纳入知识库调查。
- 详细规范先看 `../xiaochengxu/RULES.md`；代码事实见 `docs/modules/mini-program.md`。

## 后端启动结构（已核对）

`content-service/src/index.js` 是唯一服务入口：

1. 加载 `.env` 并集中校验数据库、密钥、跨域、OSS、短信和隐私版本配置，创建 Fastify 实例，HTTP body 上限为 10 MiB。
2. 注册 CORS、Cookie、Prisma、JWT、OSS、Multipart 插件。
3. 添加后台岗位权限 Hook 和脱敏安全记录 Hook。
4. 注册旧版认证、新版认证以及各业务路由。
5. 默认监听 `0.0.0.0:3001`，可由 `HOST`、`PORT` 调整。
6. 在进程内启动常规定时任务；牛量和创作者财务任务只有对应首发开关启用时才启动。

当前 `package.json` 已有 `dev`、`start`、`npm run check`、`npm run check:staff-security`、`npm run check:private-files`、`npm run check:account-deletion`、`npm run check:launch-safety` 和 `npm run check:customization-flow`。专项脚本覆盖岗位、文件、注销、功能开关、协议记录、防刷和定制提交，并在结束后清理测试数据。项目仍没有完整 CI，早期本地库的 Prisma 迁移基线也尚待 R0.2 处理。

## 技术栈事实（已核对）

| 范围 | 当前实现 |
|---|---|
| Web 前端 | 静态 HTML、页面内 CSS/JS、公共原生 JS；无主站构建链 |
| API | Node.js ESM、Fastify 5 |
| ORM / 数据库 | Prisma 5、PostgreSQL |
| 鉴权 | `@fastify/jwt`；首发使用 Access/Refresh 设备会话，旧登录入口停用；后台使用固定 `staffRole` 岗位权限 |
| 文件存储 | `local`/阿里云 OSS 适配层；新上传使用 `private_files` 登记用途、所有权、校验与业务绑定，短期签名读取 |
| 图片/动图 | `canvas`、`gif-encoder` |
| 文件打包/文档 | `archiver`、`bwip-js`、DOCX 模板 |
| 小程序 | uni-app、Vue 3、TypeScript、Pinia、uview-plus、Vite |

## 数据库规模（已核对）

`content-service/prisma/schema.prisma` 当前定义（2026-08-23 生产批次骨架完成后）：

- 93 个 Prisma `model`。
- 4 个 Prisma `enum`：`UserStatus`、`SmsPurpose`、`ActionType`、`StaffRole`。
- 数据表覆盖用户、内容社交、动画/商品、定制订单、联名、库存生产、结算、牛量、合同链接、账户安全、购物车地址和材料等领域。

旧文档中仍出现 36、37、43、44 张表等历史数字，不能用这些数字判断当前数据库；详见 `docs/DOC_CODE_DIFFERENCES.md`。

## 调查批次

| 批次 | 范围 | 状态 |
|---|---|---|
| 0 | 文档体系、代码版图、调查规范 | 已完成 |
| 1 | 服务入口、插件、认证、会话、安全、短信、上传、账户设置 | 已完成第一轮代码核对 |
| 2 | 商品、机型、定制、购物车、地址、订单、支付、库存、材料 | 已完成第一轮代码核对 |
| 3 | 联名、创作者、收益、结算、牛量、合同、链接 | 已完成第一轮代码核对 |
| 4 | 内容社区、用户、认证申请、通知、联络表单 | 已完成第一轮代码核对 |
| 5 | 管理后台、生产、导入、批次、扫码、定时任务 | 已完成第一轮代码核对 |
| 6 | Web 前端逐页面与公共脚本 | 已完成第一轮代码核对（44 个现行页 + 9 个旧版页） |
| 7 | 小程序页面、Store、请求层与主后端契约 | 已完成第一轮代码核对（14 个页面、3 个 Store、请求层与后端契约） |
| 8 | 环境、部署、迁移、测试、监控、安全和容量总评估 | 已完成第一轮代码与本地数据库核对 |

## 事实记录规则

- **已核对**：直接阅读当前代码或 Schema 后得出的事实。
- **文档声称**：原文档中的规划或状态，尚未与全部代码核对。
- **部分实现**：有相关代码，但关键流程、边界或消费者没有完全闭环。
- **待确认**：仅凭代码无法确定产品意图，需要和项目负责人讨论。
- **风险**：当前实现可能影响安全、数据一致性、性能或维护性，不代表本轮已经修改。

## 批次执行约定

- 每个调查批次开始时，先向项目负责人复述本次持续遵守的需求和边界，避免长任务中遗漏目标。
- 每批都要同时核对代码、现有 Markdown、数据模型、接口、前端消费者和文件依赖，并主动识别安全、并发、性能、一致性与改造复杂度。
- 主入口只保留稳定简要信息，详细事实写入 `docs/modules/`；不删除历史信息，冲突内容进入差异台账。
- 只凭代码无法确定的产品规则进入 `docs/OPEN_QUESTIONS.md`，不擅自修改业务实现。
- 业务讨论先保证问题覆盖全面，只在当前阶段确认首发范围、核心业务边界、数据责任与安全底线；字段、按钮、审批级数、状态细分和金额公式等实现细节，记录后延迟到开发对应模块时结合完整流程确认。

## 维护约定

- 新增或改变功能时，先更新对应 `docs/modules/*.md` 的代码事实，再更新总览状态。
- 接口清单以路由代码为最终事实，`docs/API.md` 用于对外说明，但两者差异必须记录。
- 数据结构以当前 Prisma Schema 为应用层事实；数据库实际状态还需用迁移记录和生产库核验。
- 不删除历史规划。规划已过时或与代码冲突时，保留原文并在差异文档注明。

## 已确认的项目背景

- 截至 2026-08-11，阿里云资源未充值，项目未正式上线，也没有真实用户。
- 因此旧接口迁移不需要承担线上用户兼容，但仍需先核对所有本地 Web 和小程序消费者再移除。
