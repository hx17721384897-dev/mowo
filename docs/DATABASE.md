# 哞屋 MOWO — 数据库设计文档

> 数据库：PostgreSQL · ORM：Prisma 5 · 共 22 张表
> 最后更新：2026年3月

---

## 一、设计原则

- **账号与展示分离** — `users` 表只存登录鉴权信息，展示信息放 `user_profiles`，查询互不干扰
- **软删除** — 所有内容表用 `status` 字段标记状态，不做物理删除，方便追溯和申诉
- **冗余计数字段** — `like_count`、`follower_count` 等为冗余字段，有变动时同步更新，避免每次打开页面都去统计
- **快照字段** — 订单成交时对价格、费率做快照，防止后续改价影响历史记录
- **内容与商品分离** — 动画内容（`animations`）和商品（`products`）独立存储，同一套动画可开多个机型商品
- **CRMEB桥接** — 交易流程交给 CRMEB，通过 `crmeb_order_id` / `crmeb_product_id` 字段与我们的表关联

---

## 二、表总览

| 分组 | 表名 | 说明 |
|------|------|------|
| 第一组：用户与身份 | `users` | 账号主表，登录鉴权 |
| | `user_profiles` | 所有用户的主页展示信息 |
| | `creator_profiles` | 创作者专属扩展信息 |
| | `certify_applications` | 创作者认证申请记录 |
| | `credit_scores` | 信用分主表 |
| | `credit_logs` | 信用分变动记录 |
| | `reports` | 举报记录 |
| 第二组：文章与社区 | `articles` | 文章主表 |
| | `article_products` | 文章关联商品（多对多） |
| | `comments` | 评论（支持二级回复） |
| | `likes` | 点赞（文章+评论合并） |
| | `collects` | 收藏 |
| | `follows` | 关注关系 |
| 第三组：动画内容与商品 | `animations` | 动画内容本体 |
| | `animation_frames` | 动画帧图 |
| | `products` | 创作者商品 |
| | `orders_ext` | 订单扩展（桥接CRMEB） |
| | `platform_rules` | 平台规则（费率等） |
| 第四组：收益与提现 | `earnings` | 收益明细 |
| | `balances` | 创作者账户余额 |
| | `withdrawal_requests` | 提现申请 |

---

## 三、表关系总览

```
users
  ├── user_profiles        (1:1)
  ├── creator_profiles     (1:1，仅创作者有)
  ├── certify_applications (1:N)
  ├── credit_scores        (1:1)
  ├── credit_logs          (1:N)
  ├── reports              (1:N，举报人)
  ├── articles             (1:N，作者)
  ├── comments             (1:N)
  ├── likes                (1:N)
  ├── collects             (1:N)
  ├── follows              (1:N，follower 和 following 两个方向)
  ├── animations           (1:N，仅创作者)
  ├── products             (1:N，仅创作者)
  ├── earnings             (1:N，仅创作者)
  ├── balances             (1:1，仅创作者)
  └── withdrawal_requests  (1:N，仅创作者)

articles
  ├── article_products     (1:N) ──→ products
  └── comments             (1:N)

animations
  ├── animation_frames     (1:N)
  └── products             (1:N)

products
  ├── article_products     (1:N) ──→ articles
  ├── orders_ext           (1:N)
  └── earnings             (1:N)
```

---

## 四、详细表结构

---

### 第一组：用户与身份

---

#### `users` 账号主表

账号本身的信息，只存登录鉴权相关字段。展示性内容全部在 `user_profiles`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `phone` | VARCHAR(20) | 手机号，唯一，登录凭证 |
| `password_hash` | VARCHAR(255) | 加密后的密码 |
| `certify_status` | SMALLINT | 0未申请 1审核中 2通过 3拒绝 |
| `is_banned` | BOOLEAN | 是否封号，默认false |
| `last_login_at` | TIMESTAMP | 最近一次登录时间 |
| `created_at` | TIMESTAMP | 注册时间 |
| `updated_at` | TIMESTAMP | 更新时间 |

**说明：**
- `certify_status = 2` 表示创作者身份，后端所有「是否创作者」判断基于此字段
- 注册时自动创建一条 `user_profiles` 记录和一条 `credit_scores` 记录

---

#### `user_profiles` 用户主页信息表

所有注册用户都有，注册时自动创建空记录。存储主页展示性内容。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID | 关联 users.id，唯一 |
| `nickname` | VARCHAR(50) | 昵称 |
| `avatar_url` | VARCHAR(500) | 头像OSS链接 |
| `bio` | TEXT | 个人简介 |
| `gender` | SMALLINT | 0保密 1男 2女 |
| `birthday` | DATE | 生日 |
| `city` | VARCHAR(50) | 城市 |
| `mbti` | VARCHAR(4) | MBTI，如 INFP |
| `email` | VARCHAR(100) | 邮箱，选填 |
| `follower_count` | INTEGER | 粉丝数，默认0，冗余字段 |
| `following_count` | INTEGER | 关注数，默认0，冗余字段 |
| `article_count` | INTEGER | 发布文章数，默认0，冗余字段 |
| `liked_count` | INTEGER | 累计获赞数，默认0，冗余字段 |
| `updated_at` | TIMESTAMP | 更新时间 |

**说明：**
- 冗余计数字段在对应操作发生时同步更新，不实时统计
- 与 `users` 分开存储，是因为展示数据和鉴权数据的查询场景完全不同

---

#### `creator_profiles` 创作者专属信息表

仅 `certify_status = 2` 的用户有此记录，认证通过后由系统自动创建。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID | 关联 users.id，唯一 |
| `style_tags` | VARCHAR(500) | 风格标签，JSON数组，如 ["治愈","复古"] |
| `weibo_url` | VARCHAR(500) | 微博链接，选填 |
| `xiaohongshu_url` | VARCHAR(500) | 小红书链接，选填 |
| `bilibili_url` | VARCHAR(500) | B站链接，选填 |
| `total_sales` | INTEGER | 累计销售量，默认0，冗余字段 |
| `product_count` | INTEGER | 在售商品数量，默认0，冗余字段 |
| `updated_at` | TIMESTAMP | 更新时间 |

**说明：**
- `total_sales` 每次订单成交时更新
- `product_count` 每次商品上架/下架时更新
- 评价体系针对商品本身，不在创作者维度存好评率

---

#### `certify_applications` 创作者认证申请表

每次申请新增一行，历史记录永久保留，方便追溯。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID | 关联 users.id |
| `creator_name` | VARCHAR(100) | 创作者名称/笔名 |
| `creator_type` | VARCHAR(20) | personal / studio / brand |
| `main_style` | VARCHAR(500) | 主要风格，JSON数组 |
| `portfolio_urls` | TEXT | 作品集链接，JSON数组 |
| `real_name` | VARCHAR(50) | 真实姓名 |
| `id_number_last4` | VARCHAR(4) | 身份证后4位 |
| `certify_passed` | BOOLEAN | 第三方实名核验结果，默认false |
| `copyright_confirmed` | BOOLEAN | 版权声明已勾选 |
| `agreement_confirmed` | BOOLEAN | 创作者协议已勾选 |
| `status` | VARCHAR(20) | pending / approved / rejected |
| `reject_reason` | VARCHAR(500) | 驳回原因 |
| `applied_at` | TIMESTAMP | 申请时间 |
| `reviewed_at` | TIMESTAMP | 审核完成时间 |

**说明：**
- 不存身份证原始数据和照片，只存第三方实名核验的通过结果（符合《个人信息保护法》）
- 审核通过后：`users.certify_status` 改为2，自动创建 `creator_profiles` 记录
- 被拒后重新申请，新增一行记录，历史记录保留

---

#### `credit_scores` 信用分主表

每个用户一条记录，注册时自动创建，初始100分。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID | 关联 users.id，唯一 |
| `score` | INTEGER | 当前信用分，默认100 |
| `updated_at` | TIMESTAMP | 更新时间 |

**信用分区间与权限：**

| 分值 | 创作者权限 | 普通用户权限 |
|------|-----------|------------|
| 80分以上 | 商品发布免审核直接上架 | 文章发布直接上线 |
| 60～79分 | 商品发布需审核（1-3天） | 正常使用 |
| 30～59分 | 商品发布需审核，限制每月上架数量 | 发文章需审核 |
| 30分以下 | 暂停上架权限，触发人工复查 | 触发人工复查 |

---

#### `credit_logs` 信用分变动记录表

每次加减分记一行，用于用户申诉和管理员追溯。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID | 关联 users.id |
| `delta` | INTEGER | 变动值，正数加分，负数扣分 |
| `reason` | VARCHAR(100) | 原因，如"举报成立"/"内容被下架" |
| `related_id` | UUID | 关联的内容ID或举报ID，方便溯源 |
| `created_at` | TIMESTAMP | 发生时间 |

**加减分规则：**

| 行为 | 变动 | 备注 |
|------|------|------|
| 发布内容审核通过 | +1 | 每篇文章/每件商品 |
| 举报成立（我举报别人） | +5 | 举报经审核确认有效 |
| 连续30天无违规 | +3 | 系统每月自动结算 |
| 订单完成（创作者） | +1 | 每笔成交，上限每月+10 |
| 内容被下架 | -10 | 审核发现违规 |
| 被举报成立 | -15 | 自己内容被举报且核实 |
| 恶意举报认定 | -8 | 30天内举报不成立≥3次且成立率<20% |

---

#### `reports` 举报记录表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `reporter_id` | UUID | 举报人 user_id |
| `target_type` | VARCHAR(20) | 被举报对象类型：article / product / user |
| `target_id` | UUID | 被举报对象的ID |
| `reason` | VARCHAR(50) | 举报原因，如"抄袭/色情/虚假信息" |
| `description` | TEXT | 补充说明 |
| `status` | VARCHAR(20) | pending / valid / invalid |
| `reviewed_by` | UUID | 审核管理员ID |
| `reviewed_at` | TIMESTAMP | 审核时间 |
| `created_at` | TIMESTAMP | 举报时间 |

**说明：**
- 举报成立（valid）→ 举报人 +5分，被举报人 -15分
- 举报不成立（invalid）→ 单次不扣分，进入频率观察
- 恶意举报判定：30天内不成立≥3次且成立率<20%，每次不成立额外扣3分

---

### 第二组：文章与社区

---

#### `articles` 文章主表

普通用户和创作者都可以发布。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID | 关联 users.id，作者 |
| `title` | VARCHAR(200) | 文章标题 |
| `content` | TEXT | 正文，富文本HTML |
| `cover_url` | VARCHAR(500) | 封面图OSS链接 |
| `tags` | VARCHAR(500) | 标签，JSON数组，如 ["治愈","动画机"] |
| `status` | VARCHAR(20) | draft / pending / published / rejected / removed |
| `reject_reason` | VARCHAR(500) | 审核拒绝原因 |
| `view_count` | INTEGER | 浏览数，默认0，冗余字段 |
| `like_count` | INTEGER | 点赞数，默认0，冗余字段 |
| `collect_count` | INTEGER | 收藏数，默认0，冗余字段 |
| `comment_count` | INTEGER | 评论数，默认0，冗余字段 |
| `created_at` | TIMESTAMP | 发布时间 |
| `updated_at` | TIMESTAMP | 最后编辑时间 |

**状态说明：**
- `draft` — 草稿，只有作者可见
- `pending` — 待审核，信用分低于80分时发布进入此状态
- `published` — 已发布，信用分≥80分直接进入此状态
- `rejected` — 审核拒绝，作者可见原因
- `removed` — 违规下架

---

#### `article_products` 文章关联商品表

解决文章和商品的多对多关系。创作者写文章时可插入自己的商品卡片。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `article_id` | UUID | 关联 articles.id |
| `product_id` | UUID | 关联 products.id |
| `position` | INTEGER | 商品卡片在文章中的顺序，从1开始 |
| `created_at` | TIMESTAMP | 插入时间 |

**唯一约束：** `(article_id, product_id)`

---

#### `comments` 评论表

支持二级回复，不做无限嵌套（移动端体验考量）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `article_id` | UUID | 关联 articles.id |
| `user_id` | UUID | 评论人 |
| `parent_id` | UUID | 父评论ID，顶级评论为null |
| `reply_to_user_id` | UUID | 被回复的人，用于显示"回复@xxx" |
| `content` | TEXT | 评论内容 |
| `like_count` | INTEGER | 评论点赞数，默认0 |
| `status` | VARCHAR(20) | published / removed |
| `created_at` | TIMESTAMP | 评论时间 |

**说明：**
- 评论被删除不物理删除，改 status 为 removed，防止子评论失去父级引用
- `reply_to_user_id` 用于同一顶级评论下多人互相回复时，明确"回复的是谁"

---

#### `likes` 点赞表

文章点赞和评论点赞合并存储，用 `target_type` 区分。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID | 点赞人 |
| `target_type` | VARCHAR(20) | article / comment |
| `target_id` | UUID | 点赞对象的ID |
| `created_at` | TIMESTAMP | 点赞时间 |

**唯一约束：** `(user_id, target_type, target_id)` — 防止重复点赞
**说明：** 取消点赞直接删除记录，不需要软删除

---

#### `collects` 收藏表

目前只收藏文章，商品有购物车和心愿单代替。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID | 收藏人 |
| `article_id` | UUID | 关联 articles.id |
| `created_at` | TIMESTAMP | 收藏时间 |

**唯一约束：** `(user_id, article_id)` — 防止重复收藏

---

#### `follows` 关注关系表

普通用户和创作者都可以被关注。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `follower_id` | UUID | 关注人（我） |
| `following_id` | UUID | 被关注人 |
| `created_at` | TIMESTAMP | 关注时间 |

**唯一约束：** `(follower_id, following_id)` — 防止重复关注
**说明：** 关注成立时同步更新双方的 `user_profiles.following_count` 和 `follower_count`

---

### 第三组：动画内容与商品

---

#### `animations` 动画内容本体表

创作者上传的动画内容，与商品分开存储。同一套动画可以开多个不同机型的商品，帧图只存一份。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID | 关联 users.id，创作者 |
| `title` | VARCHAR(200) | 动画名称 |
| `description` | TEXT | 动画描述 |
| `preview_url` | VARCHAR(500) | 预览GIF/视频OSS链接 |
| `frame_count` | INTEGER | 帧数，决定能配哪些机型 |
| `copyright_type` | VARCHAR(20) | original原创 / licensed授权 / buyout买断 |
| `copyright_note` | TEXT | 版权补充说明 |
| `status` | VARCHAR(20) | draft / published / removed |
| `created_at` | TIMESTAMP | 上传时间 |
| `updated_at` | TIMESTAMP | 更新时间 |

**机型与帧数对应关系：**

| 机型 | machineType值 | 支持帧数 |
|------|--------------|---------|
| 圆筒走马灯 | cylinder | 12 / 16 / 24 |
| 灯笼走马灯 | lantern | 12 / 16 |
| 六棱柱 | hexagon | 6 / 12 |
| 扁圆 | flat-round | 12 / 24 |
| 迷你挂件 | mini | 12 |

---

#### `animation_frames` 动画帧图表

单独存储每一帧，方便替换单帧而不影响整套动画。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `animation_id` | UUID | 关联 animations.id |
| `frame_index` | INTEGER | 帧序号，从1开始 |
| `image_url` | VARCHAR(500) | 帧图OSS链接 |
| `created_at` | TIMESTAMP | 上传时间 |

**唯一约束：** `(animation_id, frame_index)` — 同一动画不能有重复序号

---

#### `products` 商品表

创作者基于动画内容开设的商品，每件商品对应一套动画 + 一种机型。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `user_id` | UUID | 关联 users.id，创作者 |
| `animation_id` | UUID | 关联 animations.id |
| `crmeb_product_id` | VARCHAR(100) | CRMEB对应SKU的ID |
| `title` | VARCHAR(200) | 商品标题 |
| `description` | TEXT | 商品描述 |
| `machine_type` | VARCHAR(20) | cylinder / lantern / hexagon / flat-round / mini |
| `frame_count` | INTEGER | 帧数，需与 animation.frame_count 匹配 |
| `base_price` | DECIMAL(10,2) | 平台底价，从CRMEB同步 |
| `markup_price` | DECIMAL(10,2) | 创作者加价 |
| `final_price` | DECIMAL(10,2) | 最终售价 = 底价 + 加价 |
| `stock_type` | VARCHAR(20) | unlimited无限量 / limited限量 |
| `stock_limit` | INTEGER | 限量数量，unlimited时为null |
| `status` | VARCHAR(20) | draft / pending / published / rejected / removed / soldout |
| `reject_reason` | VARCHAR(500) | 审核拒绝原因 |
| `sales_count` | INTEGER | 销售数量，默认0 |
| `created_at` | TIMESTAMP | 上架时间 |
| `updated_at` | TIMESTAMP | 更新时间 |

**说明：**
- `base_price` 从CRMEB同步后存一份，避免每次显示价格都要调用CRMEB接口
- `markup_price` 和 `final_price` 分开存，方便平台查看创作者加价情况
- 平台费率不存在此表，在下单时从 `platform_rules` 实时读取并快照到 `orders_ext`
- CRMEB只有约10-15个SKU（机型×帧数组合），我们的 `products` 表记录的是每个创作者的每件商品

---

#### `orders_ext` 订单扩展表

桥接 CRMEB 订单和我们的动画数据，生产部门通过此表获取制作信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `crmeb_order_id` | VARCHAR(100) | CRMEB订单ID |
| `product_id` | UUID | 关联 products.id |
| `animation_id` | UUID | 关联 animations.id，冗余，方便生产部门直接获取 |
| `buyer_id` | UUID | 买家 user_id |
| `creator_id` | UUID | 创作者 user_id |
| `final_price` | DECIMAL(10,2) | 成交价快照，防止商品改价后对不上 |
| `platform_fee_rate` | DECIMAL(5,2) | 抽成比例快照 |
| `platform_fee` | DECIMAL(10,2) | 平台抽成金额 |
| `creator_income` | DECIMAL(10,2) | 创作者实得金额 |
| `production_status` | VARCHAR(20) | waiting等待生产 / producing生产中 / done已完成 |
| `created_at` | TIMESTAMP | 创建时间 |

**说明：**
- CRMEB负责钱（支付、物流），我们负责内容（动画数据、生产信息）
- `final_price` / `platform_fee_rate` 在下单时做快照，历史记录不受后续改动影响

---

#### `platform_rules` 平台规则表

存储可动态调整的平台参数，修改费率只需改这张表，不影响任何商品数据。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `rule_key` | VARCHAR(50) | 规则名，唯一 |
| `rule_value` | DECIMAL(10,2) | 规则值 |
| `description` | VARCHAR(200) | 说明 |
| `updated_at` | TIMESTAMP | 更新时间 |

**初始数据：**

| rule_key | rule_value | description |
|----------|-----------|-------------|
| fee_rate_default | 0.15 | 默认平台抽成15% |
| fee_rate_vip | 0.10 | 高信用分创作者抽成10% |
| credit_threshold_vip | 80 | 享受VIP费率的最低信用分 |
| earnings_lock_days | 7 | 订单完成后几天可提现 |

---

### 第四组：收益与提现

---

#### `earnings` 收益明细表

每笔订单成交后自动生成一条记录，创作者在收益页面查看。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `creator_id` | UUID | 关联 users.id，创作者 |
| `order_ext_id` | UUID | 关联 orders_ext.id |
| `product_id` | UUID | 关联 products.id，冗余，方便查询 |
| `gross_amount` | DECIMAL(10,2) | 订单总价 |
| `platform_fee_rate` | DECIMAL(5,2) | 本次抽成比例快照 |
| `platform_fee` | DECIMAL(10,2) | 平台抽成金额 |
| `net_amount` | DECIMAL(10,2) | 创作者实得金额 |
| `status` | VARCHAR(20) | pending待结算 / available可提现 / withdrawn已提现 |
| `available_at` | TIMESTAMP | 变为可提现的时间 |
| `created_at` | TIMESTAMP | 收益产生时间 |

**说明：**
- 订单刚成交 → `pending`
- 买家确认收货后N天（由 `platform_rules.earnings_lock_days` 控制）→ 系统定时任务自动改为 `available`
- 提现申请通过后 → `withdrawn`
- `platform_fee_rate` 再次快照，确保对账时费率有据可查

---

#### `balances` 创作者余额表

冗余表，存储三个余额数字，避免每次打开收益页都去统计 `earnings` 表。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `creator_id` | UUID | 关联 users.id，唯一 |
| `pending_amount` | DECIMAL(10,2) | 待结算金额，默认0 |
| `available_amount` | DECIMAL(10,2) | 可提现金额，默认0 |
| `withdrawn_amount` | DECIMAL(10,2) | 累计已提现金额，默认0 |
| `updated_at` | TIMESTAMP | 更新时间 |

**说明：** 每次 `earnings` 表状态变动时同步更新此表，保持数字准确

---

#### `withdrawal_requests` 提现申请表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `creator_id` | UUID | 关联 users.id |
| `amount` | DECIMAL(10,2) | 申请提现金额 |
| `method` | VARCHAR(20) | alipay支付宝 / bankcard银行卡 |
| `account_name` | VARCHAR(50) | 收款人姓名 |
| `account_number` | VARCHAR(100) | 收款账号 |
| `bank_name` | VARCHAR(100) | 银行名称，method为bankcard时填写 |
| `status` | VARCHAR(20) | pending审核中 / approved已打款 / rejected已拒绝 |
| `reject_reason` | VARCHAR(500) | 拒绝原因 |
| `reviewed_by` | UUID | 审核人管理员ID |
| `reviewed_at` | TIMESTAMP | 审核时间 |
| `created_at` | TIMESTAMP | 申请时间 |

**说明：**
- 收款账户信息直接存在申请记录里，不单独建绑定账户表，每次提现可用不同账户
- `reviewed_by` 记录是哪个管理员操作，方便追责

---

## 五、关键业务流程

### 用户注册流程
```
1. 写入 users 表
2. 自动创建 user_profiles 记录（空）
3. 自动创建 credit_scores 记录（score=100）
```

### 创作者认证通过流程
```
1. certify_applications.status 改为 approved
2. users.certify_status 改为 2
3. 自动创建 creator_profiles 记录
4. 自动创建 balances 记录（全部为0）
```

### 文章发布流程
```
1. 写入 articles 表
2. 判断 credit_scores.score >= 80
   - 是 → status 直接设为 published
   - 否 → status 设为 pending，进审核队列
3. user_profiles.article_count + 1
```

### 商品下单流程
```
1. CRMEB 处理支付，生成 crmeb_order_id
2. 写入 orders_ext 表（含价格和费率快照）
3. 写入 earnings 表（status=pending）
4. balances.pending_amount 增加对应金额
5. products.sales_count + 1
6. creator_profiles.total_sales + 1
```

### 收益解锁流程
```
定时任务每天运行：
1. 查询 earnings 表中 status=pending 且 available_at <= 当前时间 的记录
2. 将这些记录 status 改为 available
3. 同步更新 balances：pending_amount 减少，available_amount 增加
```

---

## 六、注意事项

- 所有金额字段使用 `DECIMAL(10,2)` 而不是 `FLOAT`，防止浮点精度问题
- 所有时间字段使用 UTC 时间存储，前端显示时转换为 UTC+8
- 软删除：内容表通过 `status = removed` 标记，不执行 `DELETE` 语句
- 快照字段（价格、费率）在业务发生时立即写入，不依赖后续查询关联表

---

*最后更新：2026年3月 · 哞屋 MOWO 技术团队*
