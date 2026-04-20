# 哞屋 MOWO — mowobox.com

> 让每帧热爱，都能被触摸。

动画机平台。用户定制专属动画机，认证创作者可联名售卖，平台全流程生产实体动画机。

---

## 快速了解项目

| 文档 | 内容 |
|------|------|
| [CLAUDE.md](./CLAUDE.md) | AI 工作守则、技术栈约束、开发规范、当前进度 |
| [PRODUCTION.md](./PRODUCTION.md) | 生产管理系统：导出地址/录入快递/帧图压缩包/扫码发货设计 |
| [REVENUE.md](./REVENUE.md) | 联名分红体系：牛能等级、分红公式、结算设计 |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 系统架构、数据流、服务器配置 |
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
└── crmeb/               # CRMEB 单商户版（只读）
```

---

## 本地启动

```bash
# 启动后端
cd content-service
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
