# RP1A_CUSTOMIZATION_ANIMATION_FACTS.md - 定制与动画专项事实调查

> 调查日期：2026-10-16
> 调查基线：`438fb1fcc4250f61ce5a402c1deb682b2bf3c208`
> 状态：RP1-A 代码事实调查完成，等待负责人确认 RQ-001～RQ-004
> 方法：只读检查 Vue、API、Prisma Schema、迁移、Scheduler、私有文件清理和现有测试；未连接或写入数据库。

## 1. 结论摘要

1. “我的定制”和“我的动画”是两个不同视角，不是重复页面：前者读取定制请求及状态时间线，后者合并正式动画资产与尚未形成资产的商品草稿。
2. `CustomizationRequest` 表示一次定制过程；`CustomProduct` 是本次选配/加购所需的动画商品工作记录；`AnimationAsset` 是可复用的动画主资产；`AnimationAssetVersion` 是确认后不可覆盖的帧版本。
3. 自助定制在选择 SKU 确认时创建资产 V1；人工定制在用户接受工作人员筛帧结果时创建资产 V1。两个动作都与请求状态变化在同一数据库事务中完成，并使用唯一 `sourceKey` 防止重复版本。
4. 修改私人动画会追加 V2/V3，不覆盖旧版本；再次购买不会复制帧文件或创建新版本，只建立新的购买用请求和商品记录并固定当前版本。
5. 删除正式私人动画是前台软删除：`status=USER_DELETED`、记录 `frontDeletedAt`；版本和历史引用保留。联名动画不能走普通用户删除。
6. 删除未提交商品草稿目前只写 `CustomProduct.status=removed`，不会同步关闭关联的 `DRAFT CustomizationRequest`，也不会立即解绑或清理文件；请求会继续出现在“我的定制”，直至另一套七天清理任务处理。
7. 已确认两项 P1：人工筛帧中间状态会使“我的动画”整个页面加载失败；用户定制接口会返回员工内部备注和其他内部字段。

## 2. 对象职责与关系

| 对象 | 当前职责 | 生命周期事实 |
|---|---|---|
| `CustomizationRequest` | 一次自助或人工定制过程、状态、选型、时间线 | 自助从 `DRAFT` 开始；人工从 `SUBMITTED` 开始；确认后进入 `CONFIRMED`，过期自助草稿进入 `CLOSED` |
| `CustomProduct` | 编辑器产出的帧工作记录，以及加购/订单所需的定制商品载体 | 当前写入状态包含 `draft`、`reviewing`、`in_cart`、`ordered`、`removed`，但 Schema 注释和 Vue 类型未包含 `reviewing` |
| `AnimationAsset` | 用户可以重命名、修改和再次购买的动画主资产 | `ACTIVE`、`USER_DELETED`、`ARCHIVED`；与一次 SKU 和一次订单分离 |
| `AnimationAssetVersion` | 不可覆盖的帧版本 | `sourceKey` 唯一，资产内 `(assetId, versionNo)` 唯一；订单和生产可固定版本 |
| `CustomizationFrameSelection` | 员工每次正式提交的筛帧结果 | 新版本追加，旧 `SUBMITTED` 结果改为 `REPLACED`；接受后为 `ACCEPTED` |
| `PrivateFile` | 文件所有权、用途、状态和业务绑定 | 文件只绑定一个资源类型/ID；动画版本引用 object key，但不一定拥有文件绑定 |

`CustomizationRequest.customProductId` 当前只是字符串字段，没有 Prisma relation 或数据库外键；代码负责维护二者一致性。动画资产/版本则有正式关系和版本唯一约束。

## 3. 页面与 API 事实矩阵

| 页面/操作 | Vue 消费者 | API | 数据事实 |
|---|---|---|---|
| 我的定制列表 | `MyCustomizationsView.vue` | `GET /api/customization-requests/mine` | 返回当前用户全部请求，页面按请求状态筛选 |
| 定制详情/时间线 | 同上 | `GET /api/customization-requests/mine/:id` | 返回请求和事件；当前响应白名单不完整 |
| 我的动画 | `MyAnimationsView.vue` | `GET /api/animation-assets` + `GET /api/custom-products` | 合并 ACTIVE 资产与 `animationAssetId` 为空的商品记录 |
| 重命名草稿 | animation feature | `PATCH /api/custom-products/:id/title` | 只改 `configJson.animName`，正式提交/清理后拒绝 |
| 重命名资产 | animation feature | `PATCH /api/animation-assets/:id` | 只改资产标题；当前没有业务审计流水 |
| 删除草稿 | animation feature | `DELETE /api/custom-products/:id` | 仅把商品状态设为 `removed` |
| 删除资产 | animation feature | `DELETE /api/animation-assets/:id` | 只做前台软删除，联名资产拒绝 |
| 重编草稿 | `CustomizeEditorView.vue` | `GET/PATCH /api/custom-products/:id/editor` | 原位更新同一个商品和关联 DRAFT 请求，不创建第二份记录 |
| 修改正式动画 | 同上 | `POST /api/animation-assets/:id/versions` | 追加不可变版本，校验基准版本和幂等键 |
| 使用动画选新款式 | customize start/confirm | `POST /api/animation-assets/:id/reuse` | 新建购买用商品和 CONFIRMED 请求，复用当前动画版本 |

## 4. 自助定制真实流程

1. 编辑器把帧图作为 `CUSTOMIZATION_FRAME` 上传。
2. `POST /api/custom-products` 使用 `clientDraftKey` 幂等创建一个 `CustomProduct(draft)`，帧文件绑定到 `CUSTOM_PRODUCT`。
3. 编辑器上传原素材作为 `CUSTOMIZATION_SOURCE`。
4. `POST /api/customization-requests/draft` 使用另一枚 `clientDraftKey` 幂等创建 `CustomizationRequest(SELF, DRAFT)`，原素材绑定到 `CUSTOMIZATION_REQUEST`。
5. 用户在确认页选择 SKU，`POST /api/customization-requests/:id/submit` 在同一事务内：
   - 把请求改为 `CONFIRMED` 并生成业务编号；
   - 以 `CUSTOMIZATION_REQUEST:{requestId}:SELF_CONFIRMED` 创建或复用动画资产 V1；
   - 把资产/版本写回请求和商品；
   - 把商品的 `draftExpiresAt` 清空；
   - 追加公开时间线事件。
6. Vue 把商品加入购物车，商品状态变为 `in_cart`；支付成功后变为 `ordered`。

客户端在响应丢失时会保留 session 级草稿 key，服务端唯一键也会返回原记录；现有浏览器检查已经覆盖“重编不产生第二份商品/请求”。成功跳到确认页后这些草稿 key 会删除，新的定制流程会获得新 key。

## 5. 人工筛帧真实流程

1. 用户上传原素材，`POST /api/customization-requests` 幂等建立 `HUMAN/SUBMITTED` 请求；此时没有商品草稿和动画资产。
2. 员工领取后请求进入 `REVIEWING`，可保存 `staffDraftData`。
3. 员工正式提交筛帧结果时，同一事务内：
   - 追加 `CustomizationFrameSelection`；
   - 创建或更新 `CustomProduct`，当前写入状态为 `reviewing`；
   - 把工作人员上传的帧转为用户所有并绑定到该 selection；
   - 请求进入 `OPTIONS_READY` 并追加含公开消息与内部备注的事件。
4. 用户接受结果时，同一事务内创建/复用动画资产 V1，把请求改为 `FRAME_ACCEPTED`，并把资产/版本写回商品。
5. 用户选择 SKU 后请求进入 `CONFIRMED`，随后商品可以加购。

资产建立时机因此已经明确：自助流程在最终选 SKU 确认时建立；人工流程在用户接受筛帧结果时建立，而不是员工提交时建立。

## 6. 正式动画版本、复购与删除

### 修改

- 只允许当前用户修改 ACTIVE 私人动画；联名或活动合作状态拒绝直接修改。
- 请求必须携带稳定 `clientVersionKey`；服务端形成唯一 `sourceKey`。
- 必须以当前版本为基准，否则返回冲突。
- 新版本追加写入，旧版本及其 manifest 不覆盖。

### 再次购买

- 固定资产当前版本，并校验目标 SKU 帧数是基础帧数的整数倍。
- 不复制帧文件、不创建新动画版本。
- 新建一条购买用 `CustomProduct` 和一条 `CONFIRMED CustomizationRequest`，二者引用同一资产版本。

### 删除

- 私人资产删除只写 `USER_DELETED/frontDeletedAt`；用户列表和详情不再返回。
- `AnimationAssetVersion`、请求、订单商品和生产文件没有被删除。
- 联名资产普通用户删除返回冲突。
- 当前确认框只说“从您的动画列表移除”，与后端软删除语义基本一致，但还应明确历史订单不受影响。

## 7. 草稿删除与过期的当前问题

### 用户手动删除

`DELETE /api/custom-products/:id` 会阻止 `in_cart`、`ordered` 和存在非 DRAFT 请求的商品；允许删除与 DRAFT 请求关联的商品，但只把商品改成 `removed`：

- DRAFT 请求仍保留 `customProductId`；
- “我的动画”立即隐藏商品；
- “我的定制”继续显示该 DRAFT 请求；
- 文件仍绑定商品/请求；
- 删除接口没有事件或审计记录；
- 最多要等请求的七天过期清理才进入 `CLOSED` 并清文件。

### 两套过期任务

1. `scheduler.cleanupExpiredDrafts` 按 `CustomProduct.draftExpiresAt` 查找，只把无购物车关联的商品改成 `removed`。
2. `cleanupExpiredCustomizationDrafts` 按 `CustomizationRequest.updatedAt` 抢占为 `EXPIRING`，物理删除素材，删除未下单商品，将请求改为 `CLOSED` 并追加事件。

二者使用不同时间来源并独立执行。第一套先执行后，会出现“商品已 removed、请求仍 DRAFT”的窗口。自助提交接口没有检查商品是否 `removed`，可能先把请求确认并创建动画资产；后续加购又会因为商品 `removed` 被拒绝，形成半完成状态。现有并发测试覆盖“请求清理与提交”的竞态，但没有覆盖“商品任务先 removed、请求随后提交”。

## 8. 私有文件生命周期事实

- 未绑定的中断上传默认 24 小时后清理。
- DRAFT 请求超过七天后先进入 `EXPIRING`，删除源文件和帧文件；删除失败记为 `DELETE_FAILED` 并可重试。
- 删除文件前使用当前绑定关系抢占，降低并发误删风险。
- 确认后的动画版本引用帧 object key；原始帧可能继续绑定在 `CUSTOM_PRODUCT` 或 `CUSTOMIZATION_FRAME_SELECTION`，资产删除不会触发文件删除。
- 当前文件保存责任依赖源商品/筛帧结果继续存在；RP5 需验证长期引用计数、账号注销和孤立对象恢复。

## 9. 已确认问题与测试缺口

### P1：人工筛帧中间态使“我的动画”无法加载

后端写入 `CustomProduct.status=reviewing`，列表接口会返回该记录；Vue `AnimationDraftStatus` 只接受 `draft/in_cart/ordered`，在检查 `animationAssetId` 后对该状态抛错。用户处于 `OPTIONS_READY` 且尚未接受结果时，整个动画列表失败。现有 E2E 只模拟合法状态。

### P1：用户接口泄露员工内部处理字段

`/mine` 用 `{...item}` 返回整条请求；`/mine/:id` 还包含未经白名单处理的完整事件。用户可以读取 `staffDraftData.internalNote`、事件 `internalNote`、员工 ID、对象 key 和其他内部字段。Vue DTO 忽略字段不能构成安全保护。

### P1：手动删除与双清理任务造成生命周期分裂

删除商品草稿、关闭请求、解绑/清理文件不是一个可恢复工作流；请求显示、旧链接提交和商品购买授权可能互相矛盾。业务删除语义需要负责人确认，技术上也必须统一状态机与补偿任务。

### P2：草稿 API 返回整行数据库对象

创建、列表、详情和更新接口多处直接返回 `CustomProduct` 整行，包括 object key、工程数据和内部字段。虽然有所有权检查，仍违反最小 DTO 原则，并让未来字段自动进入公网响应。

### 已覆盖的正向证据

- 自助提交不重复创建商品/请求；
- 草稿重编原位更新；
- 资产版本追加且幂等；
- 私人资产删除保留不可变版本；
- 七天请求过期清理文件并保留 CLOSED 时间线；
- 请求清理与提交的直接竞态保持全成或全关。

### 尚缺的自动证据

- 人工 `OPTIONS_READY + CustomProduct(reviewing)` 打开“我的动画”；
- 用户响应中不存在任何内部备注、员工草稿和私有 object key；
- 手动删除草稿同时关闭请求并可靠回收文件；
- 两套过期任务交错执行后不能确认 removed 商品；
- 清理失败重试、服务重启和多实例并发；
- 已有订单/生产引用时删除资产仍可完整查看历史版本。

## 10. 提交负责人确认的建议

### RQ-001 页面职责

建议确认：

- “我的定制”是每次定制申请的流程与历史中心；
- “我的动画”是未提交动画草稿和可复用正式动画资产库；
- 两页引用同一组领域对象，但不复制状态和文件事实。

### RQ-002 删除未提交草稿

建议确认：删除未提交动画草稿表示同时结束该次尚未提交的定制过程。数据库事务内把商品设为 removed、请求设为 CLOSED、解除可清理文件绑定并追加事件；事务后由幂等任务物理删除对象。已有购物车、正式请求、订单或生产引用时拒绝此删除。

### RQ-003 删除正式私人动画

建议确认：只从资产库隐藏并停止未来修改/复用，订单、生产和历史请求固定的不可变版本继续保留；界面明确说明历史订单不受影响。

### RQ-004 保留期限

当前实现使用七天云端草稿期限、24 小时未绑定上传期限。建议邀请测试期先保留七天，但统一为一套请求主导的过期状态机，并在草稿卡片显示明确到期时间；负责人可根据真实用户体验决定是否改为 14 或 30 天。
