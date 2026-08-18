# 哞屋 MOWO — mowobox.com

> 让每帧热爱，都能被触摸。

动画机平台。用户定制专属动画机，认证创作者可联名售卖，平台全流程生产实体动画机。

---

## 快速了解项目

> 新加入的开发者或 AI 请先阅读 [`docs/PROJECT_INDEX.md`](docs/PROJECT_INDEX.md)。该索引区分当前代码事实、历史规划、文档差异与待确认问题。
>
> **当前产品口径以 `docs/OPEN_QUESTIONS.md` 的阶段性决策为准。** `PRODUCTION.md`、`REVENUE.md` 和 `docs/ARCHITECTURE.md` 保留早期完整规划，不代表首发范围或当前代码已经闭环。首发采用精简自建订单体系；社区、线上分红/牛量/提现默认关闭，生产与库存细节在实际改造前再确认。

| 文档 | 内容 |
|------|------|
| [CLAUDE.md](./CLAUDE.md) | AI 工作守则、技术栈约束、开发规范、当前进度 |
| [docs/RELEASE_SCOPE.md](./docs/RELEASE_SCOPE.md) | 当前发布阶段、首发功能边界和延后讨论事项 |
| [docs/REMEDIATION_ROADMAP.md](./docs/REMEDIATION_ROADMAP.md) | 按功能区划分的代码整改顺序、边界和完成标准 |
| [docs/LAUNCH_READINESS.md](./docs/LAUNCH_READINESS.md) | 邀请测试、真实交易和公开上线所需的工程与运营门槛 |
| [PRODUCTION.md](./PRODUCTION.md) | 生产管理系统早期完整规划；结合当前代码调查和待确认事项阅读 |
| [REVENUE.md](./REVENUE.md) | 未来联名分红/牛量体系规划；首发不启用线上收益功能 |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 早期目标架构；CRMEB 等内容已被阶段性决策替代 |
| [docs/FRONTEND.md](./docs/FRONTEND.md) | 前端页面清单、跳转关系、API对接状态 |
| [docs/DATABASE.md](./docs/DATABASE.md) | 数据库表设计说明 |
| [docs/API.md](./docs/API.md) | 接口定义文档 |

---

## 项目结构

```
mowo/
├── CLAUDE.md            # AI 必读工作守则
├── PRODUCTION.md        # 生产管理系统规划
├── REVENUE.md           # 联名分红体系规划
├── README.md
├── docs/                # 项目文档
├── frontend/
│   ├── pages/           # HTML页面
│   └── js/
│       └── auth.js      # 公共登录状态管理
├── content-service/     # Node.js + Fastify 内容后端
│   └── src/templates/   # 对照清单/条形码清单 docx 模板
└── crmeb/               # 仅有占位文件；首发决定不接入 CRMEB
```

---

## 本地启动

```bash
# 启动后端
cd content-service
npm install
# 首次使用：按 .env.example 创建本机 .env，并填写真实的本地配置
npm run check
npm run dev
# → http://localhost:3001

# 前端用 VS Code Live Server 打开
# → http://127.0.0.1:5500
```

---

## 当前状态

### 已完成 ✅
- 定制流程三页（选款式/筛帧/选配+提交）
- OSS上传（预签名URL批量上传，mowo-uploads，上海，私有）
- 定制订单API（创建/列表/详情）
- 管理后台九页（订单四视图/联名作品/联名审核/活动管理/用户/日志/款式管理/库存管理/联络留言）
- 管理员API（生产完整流程：导出地址/录入快递/导出帧图）
- RBAC角色系统（0=用户/1=生产端/2=管理员/3=超级管理员）
- 审计日志（语义化+IP记录，自动hook）
- mowo_process.py 帧图片处理脚本
- 数据库37张表
- 定制完整生产流程（导出地址/录入快递/导出帧图压缩包）
- SKU全局排序体系（款式/SKU排序决定生产优先级）
- 导出地址新排序规则（单款排前/多款按最高SKU/数量少排前/逐位比较）
- seqNo全局序号（帧图压缩包顺序与快递面单严格一致）
- 批次管理系统（batchId绑定/文件命名统一/下拉过滤/状态灯）
- production-scan.html（查询模式+发货模式+等候区+批次追溯）
- 帧图压缩包按SKU分文件夹+对照清单+条形码清单
- 管理后台九页完整
- 联名后端完整（审核/活动/上下架/帧素材包库存/创作者端）
- admin-collab-works.html 联名作品管理页
- customize-confirm.html 四步选配重构
- **联络表单系统完整** ✅ 新增
  - contact.html 六角色卡片（画师联名/线下渠道/媒体合作/加入哞屋/反馈&创意共建/厂家合作）
  - 未登录拦截（弹登录提示，不显示表单）
  - 文件上传（简历/作品集，走OSS预签名，支持PDF/Word/ZIP/图片）
  - 提交绑定用户账号（submitterUserId）
  - 防垃圾：频率限制（每IP每天5次）+ 关键词过滤 + 恶意IP自动封禁
  - admin-contact.html 联络留言管理页（两行筛选卡片/星标/状态/备注/跳转用户主页）
  - admin-users.html 支持 ?highlight=userId 定位高亮用户

### 待完成 ⬜
**高优先级**
- 用户提交定制时填写收件地址
- 小程序付款流程（目前提交即paid）

**中优先级**
- 创作者管理页面（后端接口已写）
- showcase.html + showcase-confirm.html 联名展示+下单
- 联名订单生产流程

**低优先级**
- Word排版工具（mowo_word.py）
- 小程序（订单码查询+支付+物流）
- CRMEB配置
- 服务器部署
- 社群功能（等许可证）
