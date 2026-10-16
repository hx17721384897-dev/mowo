# 哞屋 MOWO - mowobox.com

动画机商品、私人定制、联名销售和生产履约平台。用户可以购买联名动画产品，也可以上传素材制作私人动画；付款后的实物订单进入统一生产批次、打印、领料、扫码和发货流程。

---

## 快速了解项目

> 新加入的开发者或 AI 请先阅读 [`docs/PROJECT_INDEX.md`](docs/PROJECT_INDEX.md)。该索引区分当前代码事实、历史规划、文档差异与待确认问题。
>
> **当前产品口径以 `docs/RELEASE_SCOPE.md` 和工程复盘决策台账为准。** 新发现的产品/架构决定统一进入 `docs/PROJECT_ENGINEERING_REVIEW_DECISIONS.md`；`docs/OPEN_QUESTIONS.md` 作为历史问题台账保留，迁移完成前不得与新台账双向新增。历史规划不能覆盖当前代码事实。

| 文档 | 内容 |
|------|------|
| [CLAUDE.md](./CLAUDE.md) | AI 工作守则、技术栈约束、开发规范、当前进度 |
| [docs/RELEASE_SCOPE.md](./docs/RELEASE_SCOPE.md) | 当前发布阶段、首发功能边界和延后讨论事项 |
| [docs/PROJECT_ENGINEERING_REVIEW_PLAN.md](./docs/PROJECT_ENGINEERING_REVIEW_PLAN.md) | 当前 RP0～RP9 全栈工程复盘执行计划 |
| [docs/PROJECT_ENGINEERING_REVIEW_DECISIONS.md](./docs/PROJECT_ENGINEERING_REVIEW_DECISIONS.md) | 复盘期间统一的产品与架构决策台账 |
| [docs/REMEDIATION_ROADMAP.md](./docs/REMEDIATION_ROADMAP.md) | 按功能区划分的代码整改顺序、边界和完成标准 |
| [docs/WEB_COMMERCE_END_TO_END.md](./docs/WEB_COMMERCE_END_TO_END.md) | Web 联名、私人定制、混合购物车、小程序交接和生产的统一主流程 |
| [docs/DOCUMENTATION_STATUS.md](./docs/DOCUMENTATION_STATUS.md) | 全部项目文档的有效性、历史身份和复核进度 |
| [docs/LAUNCH_READINESS.md](./docs/LAUNCH_READINESS.md) | 邀请测试、真实交易和公开上线所需的工程与运营门槛 |
| [PRODUCTION.md](./PRODUCTION.md) | 历史生产规划；不能作为当前生产流程操作说明 |
| [REVENUE.md](./REVENUE.md) | 未来联名分红/牛量思想；首发不启用线上收益功能 |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 当前系统架构与业务数据归属 |
| [docs/FRONTEND.md](./docs/FRONTEND.md) | 前端页面清单、跳转关系、API对接状态 |
| [docs/DATABASE.md](./docs/DATABASE.md) | 数据库表设计说明 |
| [docs/API.md](./docs/API.md) | 接口定义文档 |

---

## 项目结构

```
mowo/
├── CLAUDE.md            # AI 必读工作守则
├── PRODUCTION.md        # 历史生产规划，等待后续压缩或退役
├── REVENUE.md           # 未来联名分红方案，首发关闭
├── README.md
├── docs/                # 项目文档
├── frontend/
│   ├── pages/           # 唯一受控旧页：后台人工筛帧编辑器
│   └── js/
│       └── auth.js      # 仅服务该旧编辑器交接的会话脚本
├── frontend-vue/        # 当前正式 Web 公共页、用户定制与交易入口
└── content-service/     # Node.js + Fastify 内容后端
│   └── src/templates/   # 对照清单/条形码清单 docx 模板
```

---

## 本地启动（隔离测试库）

```powershell
# 首次准备
cd content-service
npm install
npm run test-db:rebuild
cd ..

# 日常启动、查看状态和停止；默认只连接 mowo_b1_test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\local.ps1 start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\local.ps1 status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\local.ps1 stop
```

需要把隔离库测试订单推进到后台时，可用显式模拟支付模式启动：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\local.ps1 start -EnableMockPayment
```

该参数只允许 `mowo_b1_test` 且生产环境会拒绝；普通启动仍关闭在线结算与模拟付款。

本地启动会先构建 Vue，再同时启动 API 3001、Vue 预览 4173 和后台人工筛帧受控旧页所需的静态服务 5500。正式首页为 `http://127.0.0.1:4173/app/`；购物车、结算、订单分别在 `/app/cart`、`/app/checkout`、`/app/orders`。完整的空库、全量回归、备份恢复和人工验收流程见 [`docs/BATCH_7_LOCAL_ACCEPTANCE_AND_RECOVERY.md`](docs/BATCH_7_LOCAL_ACCEPTANCE_AND_RECOVERY.md)。

---

## 当前状态

### 已形成首轮闭环

- 账号、设备会话、员工岗位、私有文件和账号注销安全。
- 私人定制的自行筛帧、人工筛帧、动画资产、版本和已有动画复购。
- 联名商品后台工作区、唯一公开列表、唯一详情页、真实 SKU 和登录后继续购买。
- `CUSTOM + MARKET` 混合购物车、付款前冻结快照、库存预留和模拟付款。
- 一张正式总订单 `SO`、商品明细、按数量展开的单件任务 `PU`。
- 材料包库存、打印模板、生产批次、四岗位扫码、返工、装箱和发货。

### 当前主线

1. Web 生成付款前整单后，通过一次性安全领取码交给微信小程序。
2. 小程序完成微信身份、手机号核对、订单确认和官方微信支付。
3. 补齐真实退款、售后、联名成品库存优先和异常补偿。
4. 完成正式 OSS、恶意文件扫描、备份恢复、监控、压测和法律文本审查。

社区、点赞、关注、创作者线上分红、牛量和提现不是首发功能。
