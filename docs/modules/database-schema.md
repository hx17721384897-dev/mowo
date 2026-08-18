# 数据库 Schema 与迁移事实

> 调查基准：2026-08-13。应用层事实来自当前 `content-service/prisma/schema.prisma`；实际库来自对本机 `mowo_db` 的检查；迁移事实来自 `prisma/migrations/` 和 `_prisma_migrations` 状态。

## 调查范围与结论

- 当前 Prisma Schema 定义 **75 个 model、4 个 enum**，不是 Schema 文件头注释的 25，也不是 `README.md` 的 37 或 `docs/DATABASE.md` 的 63。
- 2026-08-13 已在本地库单独应用 `private_files`、账号注销、`rate_limit_buckets` 和 `consent_records` 等增量 SQL；此前数据库基线问题仍未解决。
- 仓库有 20 个历史迁移，静态 SQL 只创建 42 张表；当前另有 29 张表没有对应迁移创建记录。
- `prisma migrate status` 显示 20 个迁移在本机库中全部“尚未应用”，表明本地库不是由当前 Prisma 迁移账本建立或登记。
- 结论：**本地结构可用不等于数据库可部署**。当前无法只靠仓库在空库可靠重建与当前相同的数据库，也缺少可审计的升级/回滚链。

## 技术实现

| 项目 | 当前事实 |
|---|---|
| 数据库 | PostgreSQL，本地库名 `mowo_db`、schema `public` |
| ORM | Prisma Client / Prisma CLI 5.22.0 |
| Schema | 75 模型，使用 `@@map` 映射 snake_case 表名 |
| 迁移 | 20 个迁移目录，最晚迁移日期为 2026-04-26 |
| 种子 | `prisma/seed.js`，创建 5 类测试账号、SKU/库存、联名活动和平台规则 |
| 本地验证 | `prisma validate` 通过；数据库与 Schema diff 为空 |

## 75 个模型分组

| 分组 | 模型 |
|---|---|
| 用户与账户安全 | User、UserProfile、CreatorProfile、CertifyApplication、CreditScore、CreditLog、Report、SmsCode、SmsGlobalCounter、ActionToken、RefreshToken、TokenBlacklist、AuditLog、PrivateFile、AccountDeletionRequest、AccountDeletionOperation、RateLimitBucket、ConsentRecord |
| 内容与社交 | Article、ArticleProduct、Comment、Like、Collect、Follow |
| 动画与旧商品 | Animation、AnimationFrame、Product、OrderExt、PlatformRule、Earning、Balance、WithdrawalRequest |
| 机型与订单 | MachineModel、MachineModelSku、CustomizeOrder、AftersaleRequest、ShippingBatch |
| 联名与收益 | CollabWork、CollabOrder、CollabActivity、CreatorReserve、ReserveLog、SettlementRecord、PlatformConfig、BullScore、BullScoreLog、CreatorReferralLink、ReferralClick、CreatorSocialLink、CreatorContract、CreatorNotification |
| 库存与生产 | SkuInventory、InventoryLog、AuthCode、PlatformSkuMapping、ProductionBatch、BatchItem、FrameInstance、InventorySnapshot、OrderItemBinding、ChannelQuota、OperationLog |
| 帧包与材料 | CollabFramePack、FramePackWork、FramePackVariant、FramePackLog、MaterialItem、MaterialLog、MaterialSkuBinding |
| 联络 | ContactSubmission |
| 新购物车 | Cart、CartItem、CustomProduct、PreOrder、UserAddress、ContentQuota |

完整字段和关系仍以 Schema 为准；各业务语义见对应模块文档。此处不复制 75 张表的全部字段，避免再次产生一份难以同步的 Schema 镜像。

### 本轮新增表

| 表 | 用途 | 隐私与生命周期 |
|---|---|---|
| `rate_limit_buckets` | 跨重启/多实例共享短信、验证码错误、联络和上传频率计数 | `subject_hash/target_hash` 使用服务端密钥 HMAC，不存手机号或 IP 原文；过期超过 24 小时后清理 |
| `consent_records` | 分别记录用户协议和隐私政策的同意证据 | 保存用户、类型、版本、场景、时间、IP、User-Agent；注销和法定保存规则需随正式政策确定 |

本轮没有对现有库执行 `prisma migrate deploy`。由于历史迁移账本不完整，该命令可能应用超出本轮范围的旧迁移；只执行了已核验且使用 `IF NOT EXISTS` 的单个增量 SQL。完整基线仍是发布阻断项。

## 迁移缺口

下列 29 张表存在于当前 Schema 和本地数据库，但没有出现在任何受版本控制的 `CREATE TABLE` 迁移中：

```text
action_tokens            aftersale_requests        audit_logs
batch_items              cart_items                carts
channel_quotas           collab_frame_packs        contact_submissions
content_quotas           creator_notifications     custom_products
frame_instances          frame_pack_logs           frame_pack_variants
frame_pack_works         inventory_snapshots       material_items
material_logs            material_sku_bindings     order_item_bindings
platform_sku_mappings    pre_orders                production_batches
refresh_tokens           sms_codes                 sms_global_counters
token_blacklist          user_addresses
```

此外，迁移 SQL 中已有表后来增加的大量字段、索引和约束也未必有迁移记录。不能只补 29 个 `CREATE TABLE`，应以一个临时空库演练来生成并验证完整基线。

### 建议处理方式

由于当前没有真实用户和生产库，推荐选择低历史负担的方式：

1. 冻结当前 Schema 和业务代码片刻，备份本地开发库。
2. 生成一份能从 empty 创建当前完整结构的基线迁移。
3. 在全新临时 PostgreSQL 中执行 `prisma migrate deploy`，再运行种子和最小 API 冒烟测试。
4. 将本地现有库按 Prisma baselining 流程标记为已应用，避免破坏开发数据。
5. 后续所有 Schema 变更只通过迁移进入共享环境，CI 每次从空库验证。

不建议直接对现有库运行未核对的 20 个旧迁移，也不建议继续把 `prisma db push` 当正式部署流程。

## 数据约束与索引

当前 Schema 有 49 个显式 `@@index`、14 个复合唯一约束和 24 个字段级唯一约束，但覆盖并不均匀。多张高增长表没有围绕真实查询建立完整索引，例如订单状态/来源/批次、操作日志时间、内容状态/创建时间、结算状态/时间等。

索引不能按“字段看起来重要”盲目增加。推荐流程是：

1. 从首发业务查询和排序条件建立索引候选矩阵。
2. 用代表性数据量运行 `EXPLAIN (ANALYZE, BUFFERS)`。
3. 增加必要的复合/部分索引，并检查写放大和唯一约束。
4. 在容量测试中确认 P95/P99，而不是仅看本地少量数据。

## 数据类型与一致性

- 订单价格大多使用 Decimal，但联名分红、储备金、合同等仍有 Float/JavaScript Number，正式财务应统一整数分或 Decimal，并使用不可变流水。
- 多个状态仍是自由字符串，没有数据库枚举/检查约束；非法状态只能依靠分散路由逻辑阻止。
- JSON 字符串保存帧列表、SKU 列表、合同付款记录、购物车条目 ID 等，难以建立外键、索引和并发安全更新。
- 部分冗余计数和余额依赖多入口同步更新，没有统一校准、对账和补偿机制。
- 多处业务唯一性采用“先查再写”，缺数据库唯一约束或未处理唯一冲突，高并发下会竞态。

## 数据安全与生命周期

数据库包含手机号、收货人姓名/电话/地址、提现账号、IP、用户代理、合同与附件索引、原帧对象键等敏感或高价值数据。当前未见：

- 按数据类型定义的保留期限与自动清理任务。
- 数据库字段级/应用层加密方案及密钥轮换。
- 生产数据脱敏后进入测试环境的规则。
- 备份加密、跨可用区副本、恢复演练和删除传播说明。
- 高权限数据库账号拆分、只读分析账号和最小权限运行账号配置。

## 种子数据风险

`prisma/seed.js` 内含固定手机号和统一弱测试密码，并创建 role 3 超管。它适合本地演示，不得在生产环境运行。建议把种子拆成：

- 无账号的基础配置种子，可在受控环境重复运行。
- 只用于测试环境的示例数据，受环境变量硬阻断生产执行。
- 首个生产管理员通过一次性引导或运维命令创建，并强制改密/二次验证。

## 风险与整改复杂度

| 优先级 | 风险 | 影响 | 复杂度 |
|---|---|---|---|
| P0 | 本地库与 Schema 一致，但迁移账本为空 | 新环境无法可靠部署、回滚或灾备恢复 | 中；无生产数据时处理最便宜 |
| P0 | 财务与库存多入口、部分 Float/字符串状态 | 重复入账、金额误差、非法状态和对账困难 | 高 |
| P1 | PII、提现账号、合同/帧图索引缺少分类与生命周期 | 泄露、过度保留和合规风险 | 中高 |
| P1 | 高增长查询缺少基于负载的复合索引 | 数据量上升后响应和锁等待恶化 | 中 |
| P1 | 固定弱密码超管种子可被误用于生产 | 获得最高权限 | 低 |
| P2 | 大量 JSON 字符串代替关系表 | 查询、审计、并发和迁移成本增加 | 中高，按热点逐步改 |

## 相关文档

- `docs/DATABASE.md`：截至 2026-04-16 的 63 表历史说明
- `docs/modules/commerce-orders-inventory.md`
- `docs/modules/collab-creator-revenue.md`
- `docs/modules/admin-production.md`
- `docs/modules/operations-quality.md`
- `docs/DOC_CODE_DIFFERENCES.md`
