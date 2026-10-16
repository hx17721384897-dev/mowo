# ENGINEERING_REVIEW_BASELINE.md - RP0 工程复盘基线

> 基线日期：2026-10-16
> 基线 commit：`3845931e8d5b66d670510ff98e19fa08fcd327cf`
> 分支：`feature/mowo-order-redesign`
> 状态：RP0 完成；下一阶段为 RP1-A 定制/动画专项只读事实调查

## 1. 本轮边界与安全结果

- 建立基线前工作区无未提交文件；本轮只修改复盘和活动入口文档。
- 未启动服务、未连接或写入数据库、未执行迁移、seed、backfill、清理任务或业务回归。
- `mowo_db` 继续只允许只读审计与备份；自动回归只允许明确识别的 `mowo_b1_test`。
- 用户正在独立调整订单域。当前分支名和最近提交均表明订单仍是活动工作流；RP0～RP1 可以定位依赖，但不得修改或下最终正确性结论。
- 订单重新纳入条件：项目负责人宣布稳定，记录稳定日期和 commit；随后补做 RP1 订单依赖图，再进入 RP2、RP4、RP7A～C。
- 其他领域不因订单阻塞而停止，可形成局部结论；所有跨订单结论必须标记“受订单改动阻塞”。

## 2. 可复现的代码快照

下列数量来自文件系统和 Prisma 源文件自动统计，只对本 commit 有效：

| 项目 | RP0 快照 |
|---|---|
| Prisma models | 83 |
| Prisma enums | 4 |
| 迁移目录 | 75 |
| 最后迁移 | `20261015120000_add_fulfillment_hold` |
| Schema SHA-256 | `1FF056D0A9118E513BC18628CB5F3C72DAEBA4F806A71B90212B956890859F4F` |
| Vue `*View.vue` | 38 |
| `frontend-vue/src` 文件 | 159 |
| 后端 `src/routes/*.js` | 28 |
| 遗留 HTML | 1：`frontend/pages/customize-editor.html` |
| GitHub Actions workflow | 1：`frontend-vue.yml` |

复现方法：对 `schema.prisma` 匹配行首 `model`/`enum`，统计 `prisma/migrations` 目录，对 Schema 计算 SHA-256，并按上述目录/后缀统计文件。后续报告引用数量时必须同时附带 commit 或新的快照。

## 3. 当前运行与技术环境

| 范围 | 当前事实 |
|---|---|
| 本机 Node/npm | Node `v22.16.0`、npm `10.9.2` |
| Vue | Vue 3 + TypeScript + Vite + Vue Router + Pinia；正式 base 为 `/app/` |
| Vue 本地端口 | 开发 `5173`，本地计划使用 preview `4173` |
| API | Node ESM + Fastify 5，默认本地 `3001` |
| ORM/数据库 | Prisma 5 + PostgreSQL；本机 `psql 18.3`，不表示部署端版本已确认 |
| 旧静态服务 | `5500`，仅为人工筛帧旧编辑器和旧地址交接提供受控入口 |
| 本地启动 | `scripts/local.ps1 start/status/stop`，启动时强制派生 `mowo_b1_test` |
| 小程序 | 仓库外同级 `xiaochengxu/`，基线 commit `097d35ff04580f394ce3f71fc7b3e447568dc391`；uni-app/Vue/Pinia，必须作为共享后端消费者纳入 RP1 |
| 部署入口 | Nginx `/app/` history fallback、`/api/` 独立反代、runtime config 禁止缓存、静态资源长期缓存 |

`frontend-vue/package.json` 固定 Node `>=22.12.0 <25`、npm `>=10 <12`；当前本机满足。后端 package 未声明 engines，Node/PostgreSQL 部署版本矩阵留待 RP7A/RP7C。

## 4. 功能开关与环境隔离

当前配置明确包含：

- `PASSWORD_LOGIN_ENABLED`
- `ONLINE_CHECKOUT_ENABLED`
- `MOCK_PAYMENT_ENABLED`
- `EXTERNAL_ORDER_IMPORT_ENABLED`
- `SMS_MOCK`
- `STORAGE_PROVIDER`
- 账号注销、私有文件清理和 OSS/短信配置

服务端配置约束已经表达：生产环境禁止模拟支付，模拟支付要求在线结算开启且数据库必须是 `mowo_b1_test`；外部订单导入在取得真实样表和正式映射前必须关闭。RP1/RP6/RP7A 仍需证明所有入口都服从这些约束，不能仅凭配置文件判定安全完成。

## 5. 当前正式、受限和退役边界

### 正式复盘范围

- 官网与联名商品展示；
- 账号、短信登录、设置、地址、注销与后台岗位权限；
- 私人定制、动画资产、帧素材和后台人工筛帧交接；
- 联名商品运营所需的权利来源、商品、库存、订单和履约记录；
- 混合购物车、结算、订单、库存和生产；
- 联络留言、私有文件、审计与管理后台；
- 微信小程序作为共享后端消费者。

### 受限或未完成

- 外部平台订单导入只保留受限入口，写入关闭；
- 模拟支付仅限隔离测试库，正式支付尚不能由它证明；
- `customize-editor.html` 是后台人工筛帧受控例外，最终保留或迁移需要复盘证据与决定；
- 小程序真实身份、支付、退款和真机流程尚未因 Web Vue 迁移而自动完成；
- 订单域等待用户宣布稳定后纳入最终结论。

### 已退役或首发不上线

- 社区、评论、点赞、收藏、关注；
- 线上创作者分红、余额、提现、牛量和推广归因；
- 模拟实名认证和创作者线上自助合作；
- 在线合同、商务合同台账、联名线上审核和合作暂停；
- 这些能力未来需要时按新需求建设，不恢复隐藏旧实现。

## 6. Vue 与 V6 完成口径

准确表述为：Vue 正式页面迁移与大部分旧页面退役已经完成，但整个 Vue 重构验收尚未关闭。

- V6-C2：自动证据通过，负责人视觉验收待执行；
- V6-C3～C6：实际验收待执行；
- V6-D：只有前端 CI 的局部门禁，全栈长期门禁未完成；
- 人工筛帧旧编辑器：唯一受控旧页，最终处置未定。

复盘不得把“尚未验收”直接判定为“实现缺陷”，也不得把“页面已经迁移”写成“全栈验收完成”。

## 7. CI、测试与运行任务基线

- 当前 GitHub Actions 只有 `frontend-vue.yml`，并且只在 `frontend-vue/**` 或工作流自身变化时触发；执行 lint、类型、单元、构建、部署配置和 Playwright。
- 后端、Prisma 迁移、Vue/小程序契约、历史副本恢复和跨域全流程没有对应的长期 CI 门禁。
- 后端已积累多项专项检查脚本，但“存在脚本”不等于 CI 会运行，也不等于真实文件、设备和角色流程通过。
- API 进程内启动库存快照、授权检查、预订单过期、草稿清理、自动确认收货、文件清理、账号注销和限流记录清理等 Scheduler。多实例互斥、重启补跑、积压、优雅停机和告警尚未审计，当前只能标记未知。

## 8. 文档可信等级与已处理冲突

### A：当前执行与决策入口

- `PROJECT_ENGINEERING_REVIEW_PLAN.md`
- `PROJECT_ENGINEERING_REVIEW_DECISIONS.md`
- `ENGINEERING_REVIEW_BASELINE.md`
- `ENGINEERING_REVIEW_FINDINGS.md`
- 当前 commit 的代码、Schema、迁移和配置

### B：当前专题或验收证据，需结合日期

- `RELEASE_SCOPE.md`
- V6 验收文档
- `VUE_FRONTEND_REFACTOR_PLAN.md`
- `modules/*.md`、专项验收与数据库基线

### C：历史规划或已知漂移文档

- `OPEN_QUESTIONS.md`：历史问题台账，等待映射后只读；
- `FRONTEND.md`、`DATABASE.md`、`API.md`：手工清单，不能替代当前路由/Schema；
- 未标注新 commit 的固定模型、迁移、页面数量只能视为历史快照。

RP0 已修正 `PROJECT_INDEX.md`、`CLAUDE.md`、`README.md`、`RELEASE_SCOPE.md` 和 `DOCUMENTATION_STATUS.md` 的活动入口口径。历史迁移记录不重写；其余模块文档的细节漂移由 RP1/RP3/RP5 按领域处理。

## 9. 非功能目标基线

以下数值当前没有负责人确认，全部标记 `UNKNOWN`，不能据此邀请真实用户：

| 项目 | RP0 状态 | 后续 |
|---|---|---|
| 邀请测试并发、日订单量、日上传量 | UNKNOWN | RP7C 前给出代码容量证据和保守建议，再由负责人确认 |
| 单文件/单批量上限 | PARTIAL | 部分接口已有上限，RP1/RP6 统一清点后确认 |
| 页面与 API 延迟、错误率 | UNKNOWN | RP7C 建立邀请测试阈值 |
| 浏览器/手机范围与可访问性 | UNKNOWN | RP3 提供现状和建议 |
| 日志保存期限 | UNKNOWN | RP6/RP7B 结合隐私和运维责任确认 |
| 备份 RPO/RTO | UNKNOWN | RP7C 在恢复演练证据后确认 |
| 数据库/OSS 容量预警线 | UNKNOWN | RP7B/RP7C 建议并确认 |
| 告警接收人与升级路径 | UNKNOWN | RP7B 确认责任角色 |

这些问题不会阻止 RP1～RP6 的只读事实调查，但会阻止 RP9 宣布达到邀请测试门槛。

## 10. RP0 结论与下一步

RP0 已达到基线冻结门槛：版本、环境、数据库边界、正式/受限/退役范围、订单保护、V6 完成口径、文档可信等级和未知非功能目标均已显式记录。

下一步是 RP1-A，只读追踪：

1. `我的定制` 和 `我的动画` 的 Vue 路由、View、feature、API；
2. 定制请求、动画草稿、正式资产、版本、帧图和私有文件的数据关系；
3. 自助与人工流程建立资产的准确时机；
4. 删除草稿/资产的真实行为、订单和生产引用保护；
5. Scheduler 与清理任务是否制造孤立记录、文件或重复草稿。

完成后再向负责人确认 RQ-001～RQ-003，不提前要求业务负责人根据猜测做决定。
