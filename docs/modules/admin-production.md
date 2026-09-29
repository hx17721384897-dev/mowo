# 管理后台与材料包款生产

> 2026-09-08 迁移基线更新：`20260908150000_add_frame_pack_schema` 已把后台帧包白名单、规格变体、变体库存日志和批量导出使用的 `FrameInstance` 纳入可重放迁移；隔离空库 56/56 重放及帧包层级读写通过。联名作品与订单在这些表中的关联仍是 Schema 明确保留的软引用，尚未为消除差异而猜测外键或删除策略；生产批次/扫码履约的状态机仍待专项审计。

> 最近复核：2026-09-08。
>
> 本文记录当前正式生产代码。详细工艺、编号、员工步骤和验收分别见 `../PRODUCTION_BATCH_WORKFLOW.md`、`../PRINT_PRODUCTION_PLANNING.md` 和 `../PRODUCTION_WORKFLOW_ACCEPTANCE.md`。

## 当前范围

当前只覆盖“帧素材包 + 标准材料包”的材料包款生产：

`SO 已付款 -> PB 批次 -> 地址 -> 面单 -> 生产资料 -> 帧线/材料线并行 -> 单件配对 -> 齐套装箱 -> 发货`

组装完成款、真实退款售后、联名成品库存优先和机器裁切不在当前闭环内。

## 正式对象

| 对象 | 编号/模型 | 作用 |
|---|---|---|
| 用户总订单 | `SO` / `SalesOrder` | 一次付款、一个地址、一起发货 |
| 订单商品 | `SalesOrderItem` | 冻结动画版本、SKU、价格和数量 |
| 单件生产任务 | `PU` / `CustomizeOrder` | 每件实物一个任务 |
| 生产批次 | `PB` / `ProductionBatch` | 一次管理员选单形成的冻结生产范围 |
| 批次单件 | `ProductionBatchUnit` | 保存 `PU` 的打印顺序、模板、页数和四环节状态 |
| 帧素材包 | `FP` / `ProductionFramePack` | 当前制作尝试；返工生成 `FP-02`，旧码作废 |
| 材料来源 | `KB`/`BX` | 标准材料包批次和箱码 |
| 配对记录 | `ProductionPairing` | 一件 `FP` 实际使用哪个材料来源 |
| 装箱会话 | 服务端记录 | 面单、应装 `PU` 和已扫 `FP` 的持久状态 |

旧 `ShippingBatch`、`BatchItem`、`FrameInstance`、`OrderItemBinding` 和旧单件订单状态不是正式生产事实来源。

## 页面职责

| 页面 | 当前职责 |
|---|---|
| Vue `/app/admin/orders?view=...` | 订单各阶段唯一操作入口：导出地址、填面单、导出生产资料、返工和查看结果 |
| `admin-production-batches.html` | 选择完整 `SO` 创建 `PB`，查看冻结范围、材料需求、文件、进度和返工历史 |
| `admin-print-production.html` | 维护打印裁切组、逐 SKU 顺序和 DOCX 模板版本 |
| `production-scan.html#overview` | 扫码作业总览和当前批次选择 |
| `production-scan.html#frame` | 帧包完成，扫描 `FP` |
| `production-scan.html#material` | 按 `PB` 扫描 `KB/BX` 并确认领用数量 |
| `production-scan.html#pairing` | 先激活材料来源，再连续扫描匹配 `FP` |
| `production-scan.html#packing` | 先扫面单，再扫全部 `FP`，齐套后确认发货 |

四个岗位共用一个无刷新工作台和本次浏览器会话中的当前 `PB`。旧岗位 HTML 和旧 `?station=` 地址只能跳转到统一页面，不能保留第二套界面或状态逻辑。

## 后端入口

### 生产批次 `/api/admin/production-batches`

- `GET /candidates`：按日期、款式、SKU、尺寸、帧数、打印组和来源筛选可入批完整订单。
- `GET /`、`GET /:batchId`：批次列表和冻结详情。
- `POST /`：以完整 `SO` 创建正式 `PB`，冻结全部 `PU` 和打印计划。

### 打印设置 `/api/admin/print-production`

- 读取、新增、编辑和拖拽打印裁切组。
- 逐个真实 SKU 加入组、移动、排序和移除。
- 为打印组上传一页 DOCX 模板，每次上传生成不可变模板版本。

### 生产作业 `/api/admin/production-workflow`

- 查询订单环节、扫码总览和帧打印队列。
- 按批次导出地址、绑定面单、导出冻结生产资料和下载生产总表。
- 对指定 `PU` 和指定页返工，生成新 `FP` 和重印 Word。
- 帧包完成、材料领用/退回、材料来源查询和单件配对。
- 面单装箱查询、持久装箱会话、逐件扫描和最终发货。

接口清单以三个路由文件为准，不在本文复制全部请求字段。

## 状态与副作用

1. 用户模拟或真实付款后建立 `SO/Item/PU`，状态为已付款。
2. 创建 `PB` 后订单进入待处理，并尝试生成冻结 Word；生成失败会列出具体 `PU` 和原因。
3. 导出地址后进入处理中；一个 `SO` 只导出一行。
4. 面单与 `SO` 绑定后进入待生产。
5. 首次成功导出生产资料后进入生产中，并生成每件唯一 `FP`。
6. 帧包完成与材料领用互不等待；两条线分别记录。
7. `FP + KB/BX` 配对成功时才正式扣减一套材料包，并释放对应预留。
8. 面单下全部 `PU` 已配对且逐件装箱后才能确认发货。
9. 发货事务同时更新总订单、单件任务、帧包、配对、装箱和批次状态。

重复扫描只能返回已有结果或警示，不能重复推进、扣库存或新增成功日志。

## 返工

- 未配对的帧包可以选择损坏页重印。
- 24 帧两页只坏一页时，只生成并打印指定页，但仍产生新的制作码 `FP-02`。
- 旧 `FP` 立即作废，返工原因、页码、操作人、时间和新旧码永久留痕。
- 已配对或已装箱产品不能直接走打印返工，需要未来生产异常/售后退回流程。
- 批次不额外生成整套 `R02/R03` 清单；在线批次详情显示返工次数和当前事实，纸质清单版本标记用于识别是否过期。

## 权限

- 创建批次、订单环节推进、打印配置和返工要求负责人或相应后台管理岗位。
- 帧包、领料、配对和装箱使用生产岗位权限；负责人也可操作。
- 服务端每一步重新校验员工岗位、当前 `PB`、对象状态、SKU 和前置环节，不能依赖页面隐藏或当前选择。
- 关键操作写员工操作记录；日志不能保存完整地址、手机号、Token 或私有文件签名地址。

## 当前保留的旧代码

以下内容仍需专项核对消费者后删除，不能继续扩展：

1. `src/routes/admin.js` 中旧订单导出、旧批次和旧扫码/发货入口。
2. `POST /api/admin/batches` 创建的旧 `ShippingBatch`。
3. `/api/inventory/ship` 旧发货路径。
4. `_legacy/admin-production.html` 和旧岗位跳转壳。
5. 旧 `CustomizeOrder.status` 兼容同步与旧订单展示分支。
6. 外部平台导入旧实现已于 V4-E3 删除；历史数据保留，未来按真实样表重新建立正式订单映射。

当前无真实用户，正式入口消费者迁移完成后应删除这些代码和无用模型，而不是永久维护双轨。

## 当前未完成

1. 售后退回、生产异常拆包、已配对产品返工和库存补偿。
2. 联名成品库存优先、缺货转现做和对应交期计算。
3. 机器裁切、模板物理尺寸自动校验和稳定 Word 转 PDF。
4. 取得真实平台脱敏样表后，重新实现外部订单到正式 `SO/Item/PU` 的统一映射。
5. 多实例定时任务租约、失败补偿告警、并发和容量验证。
6. 更细的功能级临时授权和高风险操作审批；首版继续使用固定岗位。

## 自动检查

在 `content-service` 运行：

```powershell
npm run check:production-batches
npm run check:print-production
npm run check:production-artifacts
npm run check:production-workflow
npm run check:production-scan-safety
npm run check:production-scan-ui
```

负责人完整人工测试使用 `../PRODUCTION_MANUAL_TEST_PLAN_STANDARD_6SKU.md`。
