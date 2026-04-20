# DATABASE.md — 哞屋 MOWO 数据库设计文档

> 最后更新：2026-04-16
> 数据库：PostgreSQL 18（本地路径 `D:\huangxiang\app\PostgreSQL\`）
> ORM：Prisma 5 — schema 位于 `content-service/prisma/schema.prisma`
> 连接串：`DATABASE_URL=postgresql://postgres:***@localhost:5432/mowo_db`

---

## 概览

共 **63 张表**，分 12 个功能组。所有表名使用下划线小写（`@@map`），字段名使用驼峰（JS层）自动映射到下划线（DB层）。

---

## 表清单

| # | 表名 | 所属组 | 说明 |
|---|------|--------|------|
| 1 | `users` | 用户与身份 | 主账户表 |
| 2 | `user_profiles` | 用户与身份 | 扩展资料（含登录安全字段） |
| 3 | `credit_scores` | 用户与身份 | 信用分 |
| 4 | `credit_logs` | 用户与身份 | 信用分变更日志 |
| 5 | `certify_applications` | 用户与身份 | 创作者认证申请 |
| 6 | `creator_profiles` | 用户与身份 | 认证创作者详情（牛量/签约字段） |
| 7 | `reports` | 用户与身份 | 举报记录 |
| 8 | `sms_codes` | 账户安全v1 | 短信验证码 |
| 9 | `sms_global_counters` | 账户安全v1 | 短信全局限速（每小时500条） |
| 10 | `action_tokens` | 账户安全v1 | 高危操作二次验证Token |
| 11 | `refresh_tokens` | 账户安全v1 | 双Token机制 RefreshToken |
| 12 | `token_blacklist` | 账户安全v1 | Token黑名单（改密/封禁即失效） |
| 13 | `audit_logs` | 账户安全v1 | PIPL合规审计日志（只增不改） |
| 14 | `articles` | 社区内容 | 文章 |
| 15 | `article_products` | 社区内容 | 文章关联商品 |
| 16 | `comments` | 社区内容 | 评论（支持嵌套回复） |
| 17 | `likes` | 社区内容 | 点赞（多态：article/comment） |
| 18 | `collects` | 社区内容 | 收藏 |
| 19 | `follows` | 社区内容 | 关注关系 |
| 20 | `animations` | 动画与商品 | 用户上传的动画文件 |
| 21 | `animation_frames` | 动画与商品 | 帧图记录 |
| 22 | `products` | 动画与商品 | 商品上架 |
| 23 | `orders_ext` | 动画与商品 | CRMEB订单扩展（平台费/创作者收益） |
| 24 | `platform_rules` | 动画与商品 | 平台费率规则键值表 |
| 25 | `earnings` | 收益与提现 | 创作者收益记录 |
| 26 | `balances` | 收益与提现 | 创作者余额账本 |
| 27 | `withdrawal_requests` | 收益与提现 | 提现申请 |
| 28 | `machine_models` | 机型与定制 | 机型款式（含sortOrder排序） |
| 29 | `machine_model_skus` | 机型与定制 | SKU规格（唯一组合+条形码+授权字段） |
| 30 | `customize_orders` | 机型与定制 | 定制订单（含多平台来源字段） |
| 31 | `shipping_batches` | 机型与定制 | 发货批次（已弃用，保留兼容） |
| 32 | `collab_works` | 联名体系 | 联名作品 |
| 33 | `collab_orders` | 联名体系 | 联名分成记录（含15天冷却期） |
| 34 | `collab_activities` | 联名体系 | 联名活动 |
| 35 | `collab_frame_packs` | 联名体系 | 帧素材包库存（on_demand/stocked） |
| 36 | `sku_inventory` | 库存与生产 | SKU库存（4态模型） |
| 37 | `inventory_logs` | 库存与生产 | 库存变动日志（含幂等Key） |
| 38 | `auth_codes` | 库存与生产 | 正版验证码（扫码发货时生成） |
| 39 | `platform_sku_mappings` | 库存与生产 | 平台规格文字→内部SKU映射 |
| 40 | `production_batches` | 库存与生产 | 生产批次主表（YYYYMMDD_HHMMSS） |
| 41 | `batch_items` | 库存与生产 | 批次内SKU看板（计划/实产/报废） |
| 42 | `frame_instances` | 库存与生产 | 定制帧图实例（content_hash防篡改） |
| 43 | `inventory_snapshots` | 库存与生产 | 每日全量快照（财务审计基准） |
| 44 | `order_item_bindings` | 库存与生产 | 扫码配对记录 |
| 45 | `channel_quotas` | 库存与生产 | 渠道配额配置 |
| 46 | `operation_logs` | 库存与生产 | 管理员操作日志 |
| 47 | `contact_submissions` | 联络表单 | 联系我们表单提交 |
| 48 | `creator_reserves` | 结算体系 | 创作者储备金账户（15%扣留） |
| 49 | `reserve_logs` | 结算体系 | 储备金变动流水（90天到期释放） |
| 50 | `settlement_records` | 结算体系 | 管理员打款凭证（按周结算） |
| 51 | `platform_configs` | 牛量系统 | 平台参数配置（热改不重启） |
| 52 | `bull_scores` | 牛量系统 | 创作者每日牛量积分快照 |
| 53 | `bull_score_logs` | 牛量系统 | 牛量等级变动记录 |
| 54 | `creator_referral_links` | 牛量系统 | 创作者专属推广链接 |
| 55 | `referral_clicks` | 牛量系统 | 推广链接点击记录 |
| 56 | `creator_social_links` | 引流与合同 | 创作者外部平台视频链接（声量维度） |
| 57 | `creator_contracts` | 引流与合同 | 大IP商务合同（不走标准分红体系） |
| 58 | `carts` | 购物车系统 | 购物车主表（每用户唯一） |
| 59 | `cart_items` | 购物车系统 | 购物车条目（MARKET/CUSTOM两种类型） |
| 60 | `custom_products` | 购物车系统 | DIY定制草稿工作区（7天有效） |
| 61 | `pre_orders` | 购物车系统 | 预订单（10分钟库存预锁） |
| 62 | `user_addresses` | 购物车系统 | 用户收货地址簿（最多20条） |
| 63 | `content_quotas` | 购物车系统 | 限量内容配额（联名限量款） |

---

## 枚举类型

```
UserStatus : ACTIVE | LIMITED | SUSPENDED | DELETED
SmsPurpose : LOGIN | REGISTER | RESET_PASSWORD | BIND_PHONE | DEACTIVATE
             STEP_UP_WITHDRAW | STEP_UP_CHANGE_PAYOUT | STEP_UP_CHANGE_PASSWORD
ActionType : WITHDRAW | CHANGE_PAYOUT_ACCOUNT | CHANGE_PASSWORD | CHANGE_PHONE
```

---

## 核心表详细说明

### users — 用户主表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID PK | |
| `phone` | String? unique | 手机号（微信only用户可为空） |
| `password_hash` | String? | SMS注册；注销后匿名化清除 |
| `role` | Int default 0 | 0=User / 1=Production / 2=Admin / 3=SuperAdmin |
| `certify_status` | Int | 0未申请/1审核中/2通过/3拒绝（兼容旧字段） |
| `status` | UserStatus | 账号状态（v1新增，优先于is_banned） |
| `wechat_openid` | String? unique | 微信登录预留 |
| `deleted_at` | DateTime? | PIPL注销时间戳 |
| `delete_reason` | String? | 注销原因（≤500字符） |
| `privacy_agreed_at` | DateTime? | 用户首次同意隐私协议时间 |
| `privacy_policy_version` | String? | 同意时的协议版本号 |

**PIPL软删除**：注销时 `status=DELETED`、`deleted_at` 写时间戳、手机号和密码哈希匿名化覆盖，数据不物理删除。

---

### user_profiles — 扩展资料（含登录安全字段）

| 字段 | 类型 | 说明 |
|------|------|------|
| `login_fail_count` | Int default 0 | 连续登录失败次数，≥5次触发锁定 |
| `login_locked_until` | DateTime? | 锁定解除时间 |
| `last_login_ip` | String? | 最后登录IP（≤50字符） |

---

### customize_orders — 定制订单

**状态流转：**
```
pending → paid → locked → processing → producing → shipped → received → aftersale / cancelled
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `order_no` | String unique | 订单号 |
| `sku_id` | String FK | 关联 machine_model_skus.id |
| `oss_path` | String | 帧图在OSS的路径前缀 |
| `frame_urls` | String | 帧图 objectKey 列表（JSON数组） |
| `status` | String | 状态流转见上 |
| `source_type` | String | `custom`（DIY）/ `collab`（联名） |
| `platform` | String | `SELF` / `TAOBAO` / `DOUYIN` / `XHS` |
| `external_order_id` | String? | 原平台订单号 |
| `lock_status` | String | `UNLOCKED` / `LOCKED`（加入批次后禁改规格） |
| `import_status` | String? | null=正常 / `pending_info`=待补收件 / `pending_sku`=SKU待确认 |
| `priority_level` | Int | 0=普通 / 1=加急 / 2=KOL（迭代预留） |
| `receiver_name/phone/address/city` | String? | 收件信息（字段名与pre_orders统一用 receiver*） |
| `batch_id` | String? | 生产批次ID（格式 YYYYMMDD_HHMMSS） |
| `seq_no` | Int? | 导出地址时写入的全局序号，帧图压缩包按此排序 |

**唯一约束**：`@@unique([platform, externalOrderId])`（platform=SELF 时 externalOrderId=null，null不参与唯一检查）

---

### sku_inventory — SKU库存（4态模型）

**核心公式（应用层计算，不存储）：**
```
available = currentStock - reservedStock - wipFrameQty - wipKitQty
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `sku_id` | String unique FK | |
| `current_stock` | Int | 总库存（含所有在制品） |
| `reserved_stock` | Int | 已下单预锁（pending_payment阶段） |
| `wip_frame_qty` | Int | 帧图在制（批次导出后，**不可回流**） |
| `wip_kit_qty` | Int | 材料包在制（取消订单可归还） |
| `finished_qty` | Int | 预制成品池（迭代预留，初期为0） |
| `safety_stock` | Int | 预警阈值 |
| `max_order_limit` | Int | 单次下单上限（防超卖） |
| `safety_factor` | Float | 流量系数（默认1.0，发视频前调至2.0） |

**状态转换（所有操作必须通过 `lib/inventory.js`，禁止路由层直接操作）：**

| 方法 | 操作 | 说明 |
|------|------|------|
| `lockInventory` | reservedStock +qty | 下单预锁 |
| `unlockInventory` | reservedStock -qty | 取消/超时释放 |
| `startWipFrame` | reservedStock -qty, wipFrameQty +qty | 批次导出帧图，不可回流 |
| `startWipKit` | reservedStock -qty, wipKitQty +qty | 批次导出材料包 |
| `rollbackWipKit` | wipKitQty -qty, currentStock +qty | 取消时归还材料包 |
| `deductWip` | currentStock -qty, wip清零 | 扫码配对完成核销 |
| `defectFrame` | wipFrameQty -qty（损耗） | 帧图报废，不回流 |
| `manualAdjust` | currentStock ± delta | 手动盘点，reason必填 |

**三级预警（`getInventoryWithAlert` 返回）：**

| alertLevel | 触发条件 |
|-----------|---------|
| `CRITICAL` | available ≤ safetyStock × safetyFactor |
| `WARNING` | available ≤ safetyStock × safetyFactor × 1.5 |
| `SUGGEST` | available ≤ safetyStock × safetyFactor × 2 |
| `OK` | 其余情况 |

---

### inventory_logs — 库存变动日志

| 字段 | 类型 | 说明 |
|------|------|------|
| `idempotency_key` | String? **unique** | 幂等Key防重复写入 |
| `type` | String | 见下方枚举 |
| `before_qty` | Int? | 操作前 available 值 |
| `after_qty` | Int? | 操作后 available 值 |
| `reason` | String? | manual_adjustment 类型时必填 |

**type 枚举值：**
`in` / `out` / `reserved` / `released` / `wip_frame_start` / `wip_kit_start` / `wip_kit_rollback` / `wip_defect_frame` / `wip_deduct` / `manual_adjustment`

---

### machine_model_skus — SKU规格

**设计原则**：一条SKU = 唯一规格组合（尺寸+材质+帧数+颜色），支持独立库存、独立定价、独立条形码。

**唯一约束**：`@@unique([modelId, size, material, frameCount, colorName])`

| 字段 | 类型 | 说明 |
|------|------|------|
| `sku_barcode` | String? | 物理条形码（格式 `MOWO-SKU-XXXX-XXXX`，贴在材料包上） |
| `sku_code` | String? | 结构化编码（如 `STD-55-12F-WD-NA`，用于平台SKU映射） |
| `sku_type` | String | `KIT`（标准定制）/ `CBR_TEMPLATE`（CBR授权）/ `MTO_TEMPLATE`（按需制造） |
| `license_expire_date` | DateTime? | CBR授权到期日 |
| `license_status` | String? | `Active` / `Expiring`（30天内到期）/ `Expired` |
| `sort_order` | Int | SKU内部排序 |

**全局排序公式**：`model.sortOrder × 1000 + sku.sortOrder`，影响导出地址排序和帧图压缩包结构。

---

### platform_sku_mappings — 平台SKU映射

| 字段 | 类型 | 说明 |
|------|------|------|
| `platform` | String | `TB`（淘宝）/ `DY`（抖音）/ `XHS`（小红书） |
| `external_desc` | Text | 平台原始规格描述文字（如"55mm 12帧 木质 原色"） |
| `internal_sku_code` | String | 映射目标：machine_model_skus.skuCode |
| `collab_work_id` | String? | null=普通定制；有值=联名款，映射至 collab_works.id |

---

### pre_orders — 预订单

| 字段 | 类型 | 说明 |
|------|------|------|
| `checkout_idempotency_key` | String **unique** | 防止同一购物车重复结算 |
| `cart_item_ids` | Text | JSON数组，结算的CartItem ID列表 |
| `status` | String | `pending_payment` / `paid` / `expired` / `cancelled` |
| `expires_at` | DateTime | 创建时间 + 10分钟（超时Cron自动释放库存） |
| `wx_pay_params` | Text? | 微信支付参数JSON（预留） |
| `receiver_name/phone/address/city` | String? | 结算时填写的收件信息 |

---

### cart_items — 购物车条目

| 字段 | 类型 | 说明 |
|------|------|------|
| `item_type` | String | `MARKET`（联名成品）/ `CUSTOM`（DIY定制） |
| `content_id` | String | MARKET=collab_work.id；CUSTOM=custom_product.id |
| `hardware_sku_id` | String FK | 关联 machine_model_skus.id |
| `snapshot_title` | String | 加购时快照的商品名 |
| `snapshot_price` | Decimal? | 加购时价格快照（用于变价检测） |
| `status` | String | `normal` / `invalid`（已结算）/ `stock_out`（缺货）/ `price_changed` |
| `config_snapshot_json` | Text? | 定制参数快照（frameCount/size/material/color等） |
| `custom_product_id` | String? | CUSTOM类型关联草稿ID |

---

### custom_products — DIY定制草稿

| 字段 | 类型 | 说明 |
|------|------|------|
| `animation_frames` | Text | 帧图列表（JSON数组） |
| `draft_expires_at` | DateTime? | 草稿7天有效期（加购/结算时延长） |
| `preview_url` | Text? | GIF动画预览（编辑器实时产出） |
| `static_preview_url` | Text? | 效果图PNG（合成后写入） |
| `config_json` | Text? | 实时定制参数 |
| `status` | String | `draft` → `in_cart` → `ordered` / `removed` |

生命周期：`draft`（编辑器保存）→ `in_cart`（加购）→ `ordered`（支付成功）→ `removed`（删除购物车）  
7天清理Cron跳过 `in_cart` 且有有效CartItem关联的草稿。

---

### user_addresses — 收货地址簿

| 字段 | 类型 | 说明 |
|------|------|------|
| `label` | String? | 标签（家/公司/学校，可自定义） |
| `province/city/district` | String | 省市区三级 |
| `detail` | Text | 详细地址（街道/楼号/门牌） |
| `is_default` | Boolean | 同一用户最多一条默认地址 |

业务约束：
- 每用户最多20条（API层校验）
- 删除默认地址时，自动将 `createdAt` 最新的剩余地址升为默认
- 切换默认地址用事务：`updateMany(isDefault=false)` + `update(isDefault=true)`

---

### collab_orders — 联名分成记录

| 字段 | 类型 | 说明 |
|------|------|------|
| `revenue_status` | String | `estimated`（未收货）→ `cooling`（冷却期）→ `available`（可提现）→ `withdrawn` |
| `cooling_end_at` | DateTime? | 收货确认 + 15天，Cron扫描此字段触发状态变更 |
| `reserve_rate` | Float | 储备金比例（初期固定15%） |
| `reserve_amount` | Float | = revenueAmount × reserveRate |
| `payout_amount` | Float | = revenueAmount - reserveAmount（实际到账） |
| `settlement_week` | String? | 打款周（格式 `2026-W14`） |

---

### production_batches — 生产批次

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | 格式 `YYYYMMDD_HHMMSS`（精确到秒，防同分钟冲突） |
| `status` | String | `Open` → `Locked` → `Processing` → `Completed` |
| `max_capacity` | Int? | 迭代预留（初期NULL不限） |

一个批次包含多个 `batch_items`，每SKU一条聚合记录（plannedQty/actualQty/defectQty）。

---

### inventory_snapshots — 每日全量快照

每天 00:00 Cron 对所有SKU各写一条，财务级审计基准。

**唯一约束**：`@@unique([skuId, snapshotDate])`

| 字段 | 类型 | 说明 |
|------|------|------|
| `total_qty` | Int | = currentStock |
| `available_qty` | Int | = currentStock - reservedStock - wipFrameQty - wipKitQty |
| `locked_qty` | Int | = reservedStock |
| `unit_cost` | Decimal? | 迭代预留：加权平均单位成本 |

---

### channel_quotas — 渠道配额

每SKU一条，运营手动设置后同步至各平台后台。

| 字段 | 类型 | 说明 |
|------|------|------|
| `buffer_pool` | Int default 10 | 负向缓冲（实际可分配 = available - bufferPool） |
| `taobao_qty` | Int | 淘宝展示配额（绝对数量） |
| `douyin_qty` | Int | 抖音展示配额 |
| `xhs_qty` | Int | 小红书展示配额 |
| `livestream_mode` | Boolean | 开启时抖音配额临时扩至60% |

建议分配比例：淘宝35% / 抖音35% / 小红书30%，bufferPool=10。

---

## 定时任务（scheduler.js）

| 触发时间 | 任务 | 操作说明 |
|----------|------|---------|
| 每2分钟 | PreOrder超时检查 | `expiresAt < now` → status=expired，调 unlockInventory 释放 reservedStock |
| 每日00:00 | 全量库存快照 | 对所有SKU写 inventory_snapshots |
| 每日08:00 | CBR授权到期检查 | 30天内 → Expiring；今日 → Expired |
| 每日03:00 | 牛量积分批处理 | 三维度计算 + 升降级，写 bull_score_logs |
| 每日 | 7天草稿清理 | 清理 `status=draft` 且 `draftExpiresAt < now` 的 custom_products |
| 每日 | CollabOrder冷却期 | `coolingEndAt < now` → revenueStatus=available |
| 每90天 | 储备金解冻 | `releaseAt < now` → 储备金转入余额，写 reserve_logs |

---

## 关键设计决策汇总

| 决策 | 说明 |
|------|------|
| **4态库存** | currentStock/reservedStock/wipFrameQty/wipKitQty，available 不存储，应用层计算 |
| **库存操作收口** | 所有写库存必须通过 `lib/inventory.js`，禁止路由层直接操作 `sku_inventory` |
| **幂等Key** | `inventory_logs.idempotency_key` 唯一索引，防止网络重试导致重复扣库存 |
| **平台联合唯一** | `@@unique([platform, externalOrderId])`，SELF+null不触发，防重复导入 |
| **SKU全局排序** | `model.sortOrder × 1000 + sku.sortOrder`，影响导出地址排序和帧图压缩包结构 |
| **seqNo** | 导出地址时写入 customize_orders，帧图压缩包按 seqNo 排序，两次导出顺序永远一致 |
| **PIPL软删除** | 注销只匿名化数据+置DELETED状态，不物理删除 |
| **草稿保护** | `in_cart` 状态的 custom_products 不被7天清理Cron删除 |
| **双Token** | accessToken(15min JWT) + refreshToken(7天, HttpOnly Cookie, DB存SHA256哈希) |
| **PreOrder幂等** | `checkoutIdempotencyKey = sha256(userId + sortedCartItemIds)`，防重复创建预订单 |
| **收件字段统一** | pre_orders 和 customize_orders 均使用 `receiver*` 前缀，不用 `recipient*` |
