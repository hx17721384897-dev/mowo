# 哞屋 MOWO — mowobox.com

> 让每帧热爱，都能被触摸。

动画机电商撮合平台。创作者上传逐帧动画，平台全流程生产实体动画机，消费者购买收藏或送礼。

---

## 快速了解项目

| 文档 | 内容 |
|------|------|
| [CLAUDE.md](./CLAUDE.md) | AI 工作守则、技术栈约束、开发规范 |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 系统架构、数据流、服务器配置 |
| [docs/FRONTEND.md](./docs/FRONTEND.md) | 前端页面清单、跳转关系、API 对接清单 |
| [docs/DATABASE.md](./docs/DATABASE.md) | 数据库表设计 |
| [docs/API.md](./docs/API.md) | 接口定义文档 |

## 项目结构

```
mowo/
├── CLAUDE.md            # AI 必读工作守则
├── README.md
├── docs/                # 项目文档
├── frontend/            # 纯静态前端（HTML/CSS/JS）
├── content-service/     # Node.js + Fastify 内容后端
└── crmeb/               # CRMEB 单商户版（只读）
```

## 当前状态

- ✅ 前端页面全部完成（21 个页面）
- 🔲 数据库表设计（进行中）
- 🔲 content-service 后端开发
- 🔲 前端对接 API
- 🔲 CRMEB 配置
- 🔲 服务器部署
