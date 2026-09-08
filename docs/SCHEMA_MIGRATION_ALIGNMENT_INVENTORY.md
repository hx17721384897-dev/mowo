# Schema 与迁移对齐清单

> 最后复核：2026-09-08
> 目的：记录当前 `prisma/schema.prisma` 与 51 份可重放历史迁移之间的差异，作为独立的 P0 整改输入。它不授权对 `mowo_db` 直接执行任何迁移。

## 1. 已确认的边界

- `mowo_b1_test` 已从零完整重放 51/51 份迁移，`prisma migrate status` 为最新。
- 用 `prisma migrate diff --from-migrations ... --to-schema-datamodel ...` 在隔离 `mowo_b1_shadow` 复核，迁移终态仍未等于当前 Prisma Schema。
- 差异的主要原因是早期用 `prisma db push` 或手工改库后，没有同步产生正式迁移。
- 当前结论只适用于新空库的结构分析；`mowo_db` 仍有 37 份未应用迁移，禁止直接执行 `migrate dev`、`migrate deploy` 或自动生成的对齐 SQL。

## 2. 处理原则

1. 先按领域写清数据事实源和仍有消费者的模型，再生成新增迁移。
2. 只新增字段、表、索引或枚举的变更可在隔离库逐组验证；不把整个差异输出直接作为一次大迁移。
3. “删除外键、放宽非空、修改既有类型/默认值”属于数据约束变更，必须先确认业务规则、现库数据和回退方式。
4. 已从 B1 移除的创作者自助功能，其历史模型/数据先保留；不能借对齐之机物理删除。
5. 每个领域完成后，都要在空库重放、做针对性脚本验证，并更新本清单和审计台账。

## 3. 精确差异清单与推荐批次

| 分组 | Prisma Schema 比迁移终态多出的结构 | 风险与处理建议 | 推荐批次 |
|---|---|---|---|
| 账户、会话、隐私 | 枚举 `UserStatus`、`SmsPurpose`、`ActionType`；`users` 的状态、微信标识、删除/隐私字段及手机号/密码可空；`user_profiles` 的通知、隐私可见性、登录失败/锁定与昵称更新时间；表 `sms_codes`、`sms_global_counters`、`action_tokens`、`refresh_tokens`、`token_blacklist`、`audit_logs`、`user_addresses`。 | 已新增 `20260908103000_add_account_security_schema`，覆盖 B1 账户 API 实际依赖的枚举、状态/隐私字段、资料安全字段与短信/会话/审计表；空库 52/52 重放以及注册、账户读取、当前设备退出冒烟均通过。`users.phone` 可空与其他默认值差异仍待业务确认，未为消除 diff 而放宽。 | 批次 2 前置 / P0-A（第一切片完成） |
| 交易、订单、售后 | `customize_orders` 的平台、外部订单、锁定、优先级、收货/发货、买家备注、售后计数等字段；`aftersale_requests`、`carts`、`cart_items`；`pre_orders` 的状态/订单类型文本化；`custom_products.status` 文本化。 | 已新增交易工作区迁移与 `20260908130000_add_order_fulfillment_timestamps`，补齐购物车、地址、售后、订单扩展及生产任务的发货/收货时间。空库 54/54 重放、地址 CRUD 通过。订单职责已确认：`SalesOrder` 是总订单、`SalesOrderItem` 是成交快照、`CustomizeOrder` 是单件生产/物流任务；用户状态与内部 `fulfillmentStatus` 分开。`PreOrder`/草稿类型定义仍待状态机规范后收口；真实支付保持关闭。 | 批次 3 / P0-B（第二切片完成） |
| SKU、库存、外部订单 | `machine_models.model_type`；`machine_model_skus` 的 `sku_code`、类型和授权字段；`sku_inventory` 的完工/WIP/仓库/安全系数；`inventory_logs` 的前后库存、原因、幂等键；表 `inventory_snapshots`、`order_item_bindings`、`channel_quotas`、`platform_sku_mappings`。 | 已新增 `20260908140000_add_sku_inventory_schema`：覆盖当前库存服务、库存快照/渠道配额、SKU 管理和外部订单映射已实际使用的结构。空库 55/55 重放、库存服务事务与幂等日志验证均通过。没有为“看起来正确”而新增未在 Schema 中表达的外键；SKU 编码唯一性、库存日志既有约束/类型及跨表所有权仍待 P0-F 定义。 | 批次 3、6 / P0-C（切片完成） |
| 帧包与生产辅助 | 表 `frame_pack_works`、`frame_pack_variants`、`frame_pack_logs`、`frame_instances`；生产相关索引/外键命名差异。 | 已新增 `20260908150000_add_frame_pack_schema`，覆盖后台帧包白名单/变体/库存日志和批量导出写入的帧实例。空库 56/56 重放及帧包层级读写通过。`collab_work_id`、`order_id` 按 Schema 仍是软引用，未猜测外键；生产批次、扫码履约的状态/约束仍需逐路由审计。 | 批次 5、6 / P0-D（第一切片完成） |
| 联名货架与历史创作者数据 | `collab_works` 的下架、修订、提交批次等字段；`creator_notifications`、`content_quotas`。 | 已新增 `20260908160000_add_collab_legacy_schema`，覆盖员工联名后台与账户清理仍读写的货架治理/通知结构，并保留关闭创作者平台的历史配额数据。空库 57/57 重放及联名作品、通知、配额读写通过；自助入口未恢复。`collab_works.order_no` 的可空性与迁移终态冲突留给 P0-F。 | 批次 1、5 / P0-E（切片完成） |
| 外键、索引与默认值冲突 | Diff 建议删除 `animation_assets.owner_user_id`、`custom_products.user_id`、`pre_orders.user_id` 三个外键，及 `frame_asset_drafts_owner_user_id_idx`；多个 `updated_at` 默认值不同；还有 `shelf_status`、`pre_orders`、`custom_products` 的类型差异。 | **禁止自动采纳删除操作。** 这更可能是 Schema 少写 relation 或历史库约束与模型未同步，而不是“外键应该删除”。先逐表确定所有权、删除策略和审计要求；默认值/类型变更另写兼容迁移。 | 横切 P0-F |

## 4. 分域执行顺序

```text
P0-A 账户与会话边界
  → P0-B 交易/订单状态模型
    → P0-C SKU 与库存事实源
      → P0-D 生产与帧包
        → P0-E 联名历史数据与后台
          → P0-F 外键、索引、类型、默认值收口
```

每一项均以“模型消费者清单 → 小型迁移 → 空库重放 → 对应接口/脚本验证 → Git 提交”的顺序执行。完成全部 P0-A 至 P0-F 前，`mowo_b1_test` 只能用来证明历史链可执行，不能作为全业务端到端测试库。

## 5. 本次未做的事项

- 未对 `mowo_db` 做结构、数据或迁移历史修改。
- 未删除任何历史创作者、社群、财务或生产数据模型。
- 未执行会写入数据库的专项业务检查脚本。
- 未直接采纳 Prisma 自动 diff 中的外键删除或可空化建议。
