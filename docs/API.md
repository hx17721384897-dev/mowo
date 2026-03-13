# API.md — 接口定义文档

> 状态：待补充。将在后端开发过程中边写边完善。

---

## 基础约定

- Base URL：`https://api.mowo.com`
- 认证方式：`Authorization: Bearer <JWT_TOKEN>`
- 响应格式：JSON
- 成功响应：`{ "code": 0, "data": {...} }`
- 失败响应：`{ "code": 400, "message": "错误描述" }`

---

## 接口分组

- `/api/auth/*` — 注册、登录、刷新 token
- `/api/works/*` — 作品 CRUD
- `/api/community/*` — 社区帖子、点赞、评论
- `/api/creators/*` — 创作者公开信息、关注
- `/api/products/*` — 创作者商品上架/编辑
- `/api/certify/*` — 创作者认证申请
- `/api/earnings/*` — 收益查询、提现
- `/api/upload/*` — 文件上传（OSS 预签名）
- `/api/shop/*` — 转发至 CRMEB（购物车、订单、支付）

---

> 详细接口文档将在开发时补充至本文件。
