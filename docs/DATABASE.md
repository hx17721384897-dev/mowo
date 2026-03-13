# DATABASE.md — 数据库表设计

> 状态：待完成。将在完成 Prisma schema 设计后补充到本文档。

---

## 数据库说明

项目使用两个数据库：

| 数据库 | 类型 | 用途 |
|--------|------|------|
| `mowo_content` | PostgreSQL | content-service 使用，存储平台自有业务数据 |
| `mowo_shop` | MySQL | CRMEB 使用，存储商城订单、支付等数据 |

---

## 表设计（待补充）

设计完成后将包含以下表的详细字段说明：

- `users` — 用户基础信息
- `creator_profiles` — 创作者扩展信息
- `certify_applications` — 认证申请记录
- `works` — 作品（文章/动画）
- `animation_frames` — 动画帧图
- `community_posts` — 社区帖子
- `post_likes` — 点赞记录
- `post_comments` — 评论记录
- `follows` — 关注关系
- `products` — 创作者商品
- `product_skus` — 商品 SKU
- `earnings` — 收益记录
- `withdrawal_requests` — 提现申请
