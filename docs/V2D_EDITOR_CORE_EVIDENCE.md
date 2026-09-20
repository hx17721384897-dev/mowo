# V2-D2 共享编辑器核心证据与迁移边界

> 状态：2026-09-20 已完成 D2-A 至 D2-C，并形成 D2-D 自动验收通过候选。全部用户编辑模式已切换到 Vue；旧 `customize-editor.html` 只保留 V4/V5 的后台筛帧和后台帧图制作，在这两个消费者完成接管前不得删除。

## 1. 事实源与规模

- 主页面：`frontend/pages/customize-editor.html`，约 2560 行，内含页面结构、样式、媒体读取、裁剪、抽帧、去重、帧编辑和用户提交逻辑。
- 模式适配：`frontend/js/customization-review-editor.js`，在主页面全局变量和 DOM 已就绪后，覆盖用户确认、后台人工筛帧和后台帧图制作行为。
- 私有上传：`frontend/js/private-upload.js`，负责申请上传、直传对象存储和完成确认。
- 真实流程回归：`content-service/scripts/check-customization-ui.mjs`、`check-frame-making.mjs`。
- 当前核心状态为 `UPLOAD → TRIM → LOAD → EDIT`；提交、失败、取消和组件卸载不是显式状态，定时器、Object URL 和播放循环由散落的全局变量管理。

## 2. 入口与消费者矩阵

| 模式 | URL 判定 | 身份与最终授权 | 载入内容 | 编辑能力 | 完成动作 |
|---|---|---|---|---|---|
| 新建私人定制 | `modelId` 或本地款式元数据；没有其他模式 ID | 浏览与本地编辑可匿名；上传和保存必须登录；服务端重新校验文件归属、机型和配额 | 用户本地视频/GIF/图片序列 | 完整编辑 | 自己筛帧保存 `CustomProduct` 与 `CustomizationRequest(DRAFT)` 后进入确认页；或直接提交人工处理 |
| 旧草稿重编 | `editId` 或兼容参数 `productId` | 登录用户且服务端校验草稿归属和可编辑状态 | `GET /api/custom-products/:id` | 设计上应完整编辑 | 应更新原草稿及其 DRAFT 请求，不得新建重复草稿 |
| 正式动画改版 | `assetId` | 登录用户且服务端校验私有动画归属；联名动画拒绝 | 当前不可变版本的签名帧地址与对象键 | 完整编辑 | `POST /api/animation-assets/:id/versions` 追加 Vn，不覆盖旧版本，返回“我的动画” |
| 用户确认人工筛帧 | `reviewRequestId` | 登录用户且服务端校验请求归属、状态和选帧版本 | 用户自己的工作人员筛帧结果 | 只读预览；禁止删帧、克隆、去重、抽帧、勾选和撤销 | 接受后进入确认页，或提交修改意见后回“我的定制” |
| 后台人工筛帧 | `adminRequestId` | `OWNER` / `CUSTOMER_SERVICE` 等服务端岗位与任务领取权；必须以接口返回的 `canEdit` 为准 | 用户原素材和工作人员草稿 | 完整编辑、自动保存、心跳 | 提交结果、提交并下一条或释放任务 |
| 后台帧图制作 | `frameDraftId` | 仅 `OWNER` / `PRODUCTION`；`READY_FOR_REVIEW` 时生产人员不可继续修改 | 后台原素材和编辑草稿 | 完整编辑、自动保存 | 生产人员提交负责人；负责人填写权利/授权资料并发布帧图资产 |

模式优先级必须显式且互斥。任一 URL 同时出现两个或更多模式 ID 时应拒绝，不得沿用旧脚本“按条件先后碰巧选中一个”的行为。

## 3. 共享能力与适配层

### 3.1 单一共享核心

核心只管理可测试的编辑状态，不直接请求接口或操作路由：

- 帧顺序、勾选状态和稳定帧 ID；
- 当前预览帧、播放速度、播放/暂停；
- 单帧取消、克隆、全选、全不选、按间隔抽帧、去重结果应用、排序与最多 30 步撤销；
- 只看已选快照和移动端勾选模式；
- 目标帧合法性：选中数必须大于零，且至少存在一个目标帧数大于等于选中数并能整除；动画改版和帧图制作使用各自策略。

### 3.2 浏览器媒体层

- 输入上限：1 至 50 个文件、合计不超过 200 MiB；图片序列只允许 JPG/PNG/WEBP，单媒体允许 GIF 或受浏览器实际支持的视频格式。
- 视频选区 0.5 至 8 秒；按 30 fps 截取、预览最长边 480 px、JPEG 质量 0.85，随后相邻帧均值哈希去重并将编辑集合控制在 150 帧以内。
- Object URL、`requestAnimationFrame`、定时器、视频事件和大 Data URL 数组必须在重选文件、切换模式和组件卸载时释放。
- 旧页面声称支持 GIF，但把 GIF 直接交给 `<video>`，没有 GIF 解码实现；这不是可复制的有效能力。D2-C 已引入锁定版本的 `gifuct-js`，按 GIF disposal 规则合成逐帧画面，并限制源 GIF 为最多 300 帧、单画面最多 16,777,216 像素、累计渲染规模最多 250,000,000 像素，输出继续受 150 帧编辑上限约束。

### 3.3 模式适配层

每个适配层只负责：加载事实数据、声明能力、保存/提交、返回地址和错误恢复。禁止通过 CSS 隐藏来实现权限。至少声明：

`canUpload`、`canMutateFrames`、`canChangeSelection`、`canSubmitRevision`、`canPublishLibraryAsset`、`canSaveVersion`、`canAutoSave`。

后端身份、对象归属、状态机、岗位和文件用途仍是最终授权边界；前端能力只负责界面和阻止误操作。

## 4. 服务端与上传契约

- 所有业务请求迁移到统一 `apiRequest`，保留超时、非 JSON 错误、Access Token 刷新和可信会话失效处理。
- 对象存储 PUT 不携带 Cookie 或 Authorization；完成确认请求才携带站内凭据。
- 上传目的严格区分：`CUSTOMIZATION_SOURCE`、`CUSTOMIZATION_FRAME`、`LIBRARY_FRAME`。
- 界面只保存对象键、业务 ID、选中索引和轻量编辑元数据；签名 URL、Data URL、Blob URL、短信凭据和上传地址不得持久化。
- 从接口得到的帧地址仅作为短期显示来源，必须经过 HTTP(S) URL 校验；不得以 `innerHTML` 拼接到 `src`。

## 5. 当前存储兼容边界

迁移期间仍需读写的轻量键：

- `mowo_customize_meta`
- `mowo_customize_frame_keys`
- `mowo_customize_frame_owner`
- `mowo_customize_draft_id`
- `mowo_customize_request_draft_id`
- `mowo_customize_human_request_id`
- `mowo_customize_request_draft_key`（Session Storage）
- `mowo_customize_request_draft_owner`（Session Storage）
- `mowo_human_submission_key`（Session Storage）
- `mowo_asset_version_key_<assetId>_<versionId>`（Session Storage）

`mowo_customize_frames` 只允许清理旧值，不再写入大帧数据。款式元数据只能用于恢复界面；继续操作前必须从公开机型接口重新获取已上架机型与允许帧数，不能把 Local Storage 当成授权或价格事实源。

## 6. 已发现且不得照搬的问题

1. `editId/productId` 加载的是对象键或上次结果帧，没有恢复原素材；下一步又强制要求当前内存中的原始 `File`，因此旧草稿重编会失败。
2. 服务端虽已有 `PUT /api/custom-products/:id`，但 `POST /api/customization-requests/draft` 对相同幂等键只返回旧记录，不更新 `selectedFrameKeys/editorData`。V2-D2 必须增加具备归属、DRAFT 状态和文件绑定校验的草稿更新契约。
3. 普通模式从 Local Storage 读取允许帧数和机型名称，可能陈旧；Vue 必须以服务端当前在售机型数据覆盖。
4. 旧页面把帧 URL 拼入 `innerHTML`；Vue 使用属性绑定和 URL 白名单，不复制该注入面。
5. 旧版 GIF 文案与真实解码能力不一致，D2-C 已用受限逐帧解码修复；MOV/WebM 是否可处理仍取决于浏览器编解码器，必须在读取阶段给出可理解失败。
6. “排序”按钮永久隐藏且没有实现，不能把它记录为已存在能力。若迁移实现排序，应作为核心能力补齐并增加测试。
7. 多处裸 `fetch` 各自处理 Token 和 JSON，网络失败、刷新和会话过期行为不一致；迁移后只保留统一请求层。

## 7. 实施顺序与删除门

1. **D2-A：纯状态核心。** 类型、模式解析、能力矩阵、帧操作、目标帧规则及单元测试；不改变运行入口。
2. **D2-B：媒体与上传基础。** 文件校验、Object URL 生命周期、视频裁剪/抽帧/哈希和私有上传适配；用小型固定素材验证内存与失败恢复。
3. **D2-C：用户新建与人工提交。** `/app/customize/editor` 接管普通用户入口，保持旧 UI；完成自己筛帧与人工处理两条路径。
4. **D2-D：用户草稿、动画改版和只读确认。** 同时补齐服务端草稿更新契约和对象归属回归；完成后旧编辑器不得再承载用户模式。
5. **D2-E：内部适配。** 后台人工筛帧与帧图制作迁入同一核心，由 V4/V5 页面壳调用。
6. **删除门。** 只有六个入口均通过自动回归和负责人视觉验收，且全仓无旧消费者时，才能删除 `customize-editor.html`、`customization-review-editor.js` 和旧 `private-upload.js`。

每一段都执行“自动回归 → 负责人视觉确认 → 切换该模式入口 → 引用扫描”。不得一次切换六种模式，也不得为用户和后台复制两套帧操作实现。

## 8. D2-B 完成记录（2026-09-18）

- 建立严格素材边界：1 至 50 个文件、总计不超过 200 MiB；图片序列仅接受扩展名与 MIME 均匹配的 JPG/PNG/WEBP，视频仅接受单个 MP4/WebM/MOV 并调用浏览器实际解码能力检查。D2-B 曾先明确拒绝旧版虚假 GIF 支持；D2-C 在加入受限解码器和资源上限后正式开放 GIF。
- 建立 0.5 至 8 秒裁剪校验、30 fps/最长边 480 px/JPEG 0.85 的视频抽帧、图片序列解码、均值哈希相邻帧标记和最多 150 帧的均匀收敛。处理过程支持 `AbortSignal`，图片位图、视频事件、超时和 Object URL 均有明确释放责任，不在持久状态中保存 Data URL/Blob URL。
- 抽取共享私有上传服务并由“联系我们”既有上传复用；站内预签名和完成确认继续走统一 `apiRequest`，完成地址必须命中 API 同源及固定路径，对象存储 PUT 固定 `credentials: omit` 且不会继承 Authorization、Cookie 或上传会话头。
- 新增 11 项单元测试，覆盖伪装文件、混合素材、GIF/编解码器拒绝、体积/数量/裁剪边界、远程帧 URL、Object URL 清理、哈希/限帧和上传凭据隔离。D2-B 只增加独立基础设施，尚未切换旧编辑器的任何入口。

## 9. D2-C 完成候选记录（2026-09-20）

- `/app/customize/editor?modelId=...` 已完成用户新建的上传、机型比例提示、视频 0.5 至 8 秒裁剪、30 fps 抽帧、GIF 解帧、图片序列处理和完整帧编辑；帧编辑保留播放/速度、首帧/前后帧/末帧、全选/全不选、仅看已选、克隆、取消、撤销、感知去重、按间隔抽帧、移动端长按勾选模式、水印预览和目标帧规则。
- 人工处理继续复用同一素材选择组件和安全上传层，提交画面尺寸、时长和机型比例检查结果；自己筛帧和人工处理都只保存对象键与轻量元数据，不持久化 Blob URL、Data URL 或签名地址。
- 自助提交增加两级服务端幂等：`CustomProduct.clientDraftKey` 唯一索引阻止请求响应丢失、重复点击及并发重试产生第二份商品草稿；`CustomizationRequest.clientDraftKey` 继续阻止第二份定制申请。前端提交锁只负责交互，不能替代这两层数据库约束。重新选择素材会清除旧键，普通失败重试会复用同一键和已上传对象；服务端重放时返回原草稿实际保存的帧键，避免申请与商品帧图错配。
- 桌面 1440×900 和手机 390×844 已与旧上传页逐项对照并修正全局 margin、页面底色、格式标签和共享组件参数；正式 `/app/customize` 下一步仍指向旧编辑器，待负责人验收后才切换用户新建入口。
- 自动门禁通过：前端 41 项单元测试、68 项桌面/手机浏览器测试；20 项需显式开启的既有视觉截图用例按设计跳过。定制编辑器专项 14/14 通过，其中包含同素材刷新复用幂等键、不同素材清除旧键。服务端环境、105 个 JavaScript 文件语法和 Prisma 校验通过；隔离库 `mowo_b1_test` 的完整定制流程通过商品草稿重放、申请幂等、双账号隔离、文件绑定、并发接受、清理竞争和购物车交接。

## 10. D2-C 正式关闭记录（2026-09-20）

- `/app/customize` 已把普通新建唯一交给 `/app/customize/editor`；旧 `customize-editor.html` 对无内部模式的访问会立即转交 Vue。
- 旧页仍临时承载 `assetId/editId/productId/reviewRequestId/adminRequestId/frameDraftId`，对应 D2-D、V4 和 V5；这不是保留第二套用户新建能力。
- 真实浏览器在 Local Storage 写满后仍能上传、创建草稿并进入旧确认页；数据库断言一次操作恰好创建一个请求草稿和一个商品草稿。确认页以 URL `requestId` 优先，陈旧人工请求缓存不能串线。
- 本地代理通过保留原 Host 修复上传完成地址不一致，客户端的同源和固定路径校验保持不变。下一工作段为 D2-D。
- 正式切换后全量门禁为 41 项单元测试、70 项桌面/手机浏览器测试通过，20 项显式视觉专项按设计跳过；服务端环境、105 个 JavaScript 文件语法和 Prisma 校验通过。

## 11. D2-D 完成候选记录（2026-09-20）

- Vue 同一 `FrameEditor` 已接管 `editId/productId` 草稿重编、`assetId` 私人动画改版和 `reviewRequestId` 人工结果确认；能力参数在组件层关闭只读模式的勾选、删除、克隆、去重、抽帧和撤销，不再依靠覆盖 CSS 或隐藏按钮。
- 新增 `GET/PATCH /api/custom-products/:id/editor` 白名单契约：只返回本人可编辑草稿的短期帧地址，原位事务更新同一 `CustomProduct` 与关联 DRAFT `CustomizationRequest`。真实隔离库确认前后两类记录行数均不增加，且其他账号读写均返回拒绝。
- 动画改版继续调用既有不可变版本接口并复用会话幂等键；人工结果接受仍由服务端状态机从 `OPTIONS_READY` 推进，确认页明确携带机型事实，不依赖陈旧 Local Storage。
- `MyAnimationsView`、`MyCustomizationsView` 和旧地址均已切换 Vue；旧 HTML/JS 中四个用户模式分支已物理删除，只保留 `adminRequestId` 与 `frameDraftId`。下一步在负责人视觉检查后关闭 D2-D，再进入 D2-E 确认页迁移。
- 自动门禁通过 41 项单元测试和 76 项桌面/手机浏览器测试，20 项显式视觉专项按设计跳过；真实 Edge 完整流程、105 个服务端脚本语法与 Prisma 校验通过。
