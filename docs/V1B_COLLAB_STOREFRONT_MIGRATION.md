# V1b 联名货架迁移记录

> 状态：代码与自动验收完成（2026-09-15）；等待负责人按第 6 节进行人工体验确认。

## 1. 阶段边界

Vue 已正式接管联名商品列表、服务端分页/搜索/创作者筛选/排序、商品详情、图片和视频轮播、SKU 选择、短信登录弹窗及登录后的选择恢复。公开路由为 `/app/showcase` 和 `/app/showcase/:workId`。

V1b 不提前实现 V3 的购物车、立即购买、订单或结算。当前 `onlineCheckout=false` 时，详情页明确说明不会创建订单、锁库存或付款；登录只恢复 15 分钟内的原商品、SKU、数量和 `prepare-purchase` 操作。V3 开发时必须重新向服务端校验商品与 SKU，不能把客户端意图当成交易事实。

## 2. 安全与数据边界

- `features/collab/api.ts` 把未知 API 响应逐字段映射为公开 DTO；额外字段不会进入组件状态。必要字段缺失时按无效响应失败，不渲染半可信数据。
- 商品价格、可售 SKU、交期和供货方式只读取服务端结果，前端不自行推算。
- 待恢复操作只允许固定动作 `prepare-purchase`、1 至 10 件、15 分钟有效期；损坏、过期、未来时间或已下架 SKU 会被清除。
- 登录继续使用既有 Access Token + HttpOnly Refresh Token 架构。注册必须明确选择注册模式并同意协议，登录验证码和注册验证码不混用。
- 图片/视频加载失败只显示本地占位，不把内部对象地址、异常对象或响应正文输出到页面。
- 浏览计数需页面可见满 3 秒后上报匿名随机标识；失败不阻断浏览，服务端继续执行频率限制和同日去重。

## 3. URL 与退役收口

| 旧地址 | Vue 地址 | 处理 |
|---|---|---|
| `/mowo/frontend/pages/showcase.html?...` | `/app/showcase?...` | Nginx 302，保留查询参数 |
| `/mowo/frontend/pages/showcase-detail.html?workId=...&sku=...` | `/app/showcase/:workId?sku=...` | 先 302 到兼容路由，再由 Vue 校验并转换 |

旧 `showcase.html`、`showcase-detail.html`、`showcase-detail.js` 及三份只验证旧页面的专项脚本已删除，不保留第二套联名业务实现。仍存的旧页面导航已改向 `/app/showcase`。302 在 V6 正式切换审批前保持可调整，但回退不能恢复已删除的旧业务代码，只能回退本次 Vue 提交。

## 4. 自动验收记录

- `frontend-vue npm run check`：ESLint/Prettier、严格类型检查、4 个单测文件 7 项测试、生产构建、部署检查全部通过。
- Playwright：桌面 Chromium 与 Pixel 7 共 18 项通过。覆盖列表、筛选 URL、详情深链接、默认/指定 SKU 刷新、旧详情 URL 转换、损坏媒体、非 JSON 响应、登录恢复原 SKU/数量，以及“绝不调用购物车接口”的 V1b 边界。
- 后端 `check:collab-storefront`：公开列表/详情、内部字段不泄露、下架绕过、价格快照、数量上限和暂停后不可结算均通过。
- 后端原 `check:collab-listing` 在删除前通过列表 API、分页、排序、搜索、浏览计数和旧页面视口检查；对应 Vue 行为现由 `tests/e2e/collab.spec.ts` 接管。
- 实际截图复查了桌面列表与详情；修复了首页链接在子路由误显示 active 的样式问题。临时截图不提交仓库。
- 更新后的 B7 总门禁完整通过：60 份迁移空库重放、全部后端安全/业务专项、新 Vue 门禁，以及 `mowo_b1_test` 备份恢复演练均成功。
- Vite 开发服务器仅在本地把 `/api/*` 代理到 `127.0.0.1:3001`；生产仍由 Nginx 同源代理，运行时模板不包含本机地址或密钥。

### 中断与异常记录

第一次后端专项执行时，测试脚本默认连接开发库而临时 API 连接 `mowo_b1_test`，因数据源不一致产生假失败；随后显式校验并绑定 `mowo_b1_test` 重跑。另发现 `check:collab-storefront` 固定期待结算返回 400，与关闭支付时统一返回 404 的安全门不一致，已改为依据公开功能开关断言。旧详情浏览器脚本要求关闭支付时仍显示购买按钮，因此被判定为已迁移旧实现并删除，而不是放宽功能开关。

## 5. 后续阶段交接

- V1c：迁移联络类型、匿名附件会话、表单与错误反馈。
- V2：把本阶段的短信登录组件纳入统一账户壳，并迁移设置、地址和私人定制。
- V3：读取本阶段的短期待办意图后重新校验 SKU，再接购物车/订单；真实支付关闭时仍不得产生付款成功暗示。

## 6. 负责人手工复验

1. 确认当前没有占用 3001、5500、5173：`pwsh -File scripts/local.ps1 status`。若显示由该脚本启动，可先执行 `pwsh -File scripts/local.ps1 stop`。
2. 根目录执行 `pwsh -File scripts/local.ps1 start`，它只连接隔离库 `mowo_b1_test`；另开终端进入 `frontend-vue` 执行 `npm run dev`。
3. 打开 `http://127.0.0.1:5173/app/showcase`，检查桌面和手机宽度下的标题、筛选、空状态或真实上架商品。测试库无上架商品时出现空状态是正常结果。
4. 若有上架商品，进入详情，切换 SKU 后刷新和后退；SKU 应保留在 URL。可临时让一张媒体地址失效，确认只出现占位而不白屏。
5. 未登录点击“登录并保留选择”，验证弹窗、错误验证码提示及登录后 SKU/数量恢复。不要期待进入购物车；V1b 明确不会调用 `/api/cart/*`。
6. 测试结束，在 Vue 终端按 `Ctrl+C`，根目录执行 `pwsh -File scripts/local.ps1 stop`。

反馈时请提供：访问 URL、复现步骤、预期与实际、完整页面截图；若是请求错误，再提供浏览器 Network 中的请求路径、HTTP 状态、响应 `code/message` 和 `X-Request-Id`。不要发送 Access Token、Refresh Cookie、短信验证码、手机号或私有媒体签名 URL。
