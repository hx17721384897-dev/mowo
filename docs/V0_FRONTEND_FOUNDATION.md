# V0 Vue 基础工程与契约

> 状态：已完成并通过完整门禁（2026-09-14）

## 工程边界

- 工程目录：`frontend-vue/`；唯一包管理器为 npm，必须提交 `package-lock.json` 并在 CI 使用 `npm ci`。
- 支持 Node `>=22.12 <25`、npm `>=10 <12`；当前本机为 Node 22.16.0/npm 10.9.2。
- Vue 只在 `/app/*` 测试前缀运行。旧 HTML 仍是当前正式入口，V0 不迁移业务、不建立双写。
- 构建产物为 `frontend-vue/dist/`；Vite 生成带内容指纹的 `assets/`，生产 sourcemap 关闭。
- `public/runtime-config.js` 是公开配置，只允许 API Origin 和环境名，不得写密钥、令牌、手机号或内部存储地址；生产默认使用同源空 `apiBase`。

## 认证迁移决策

当前沿用 Access Token 位于 `localStorage(mowo_token)`、Refresh Token 位于 HttpOnly Cookie 的兼容边界，但所有新代码只能通过 `auth-session.ts` 与 `api-client.ts` 访问。`apiClient` 对 API 请求统一使用 `credentials: include`，401 时共享一个刷新 Promise，最多重试一次；刷新失败清除本地令牌和用户缓存。登出与注销模块接入时必须调用服务端退出接口后再清空本地状态。

`localStorage` Access Token 仍会扩大 XSS 影响面，不是最终安全形态。正式同域部署前评估把 Access Token 收入 HttpOnly Cookie 或 BFF；决策完成前禁止业务模块复制刷新逻辑、直接拼接 Authorization 或新增第三方脚本。

## API 与错误边界

- `apiRequest` 只接受 `/api/` 路径，集中处理 10 秒超时、JSON 解析失败、网络错误、请求 ID、认证头和统一 `ApiError`。
- 客户端错误事件仅允许 `area`、`action`、`requestId`、`status`；不得记录请求正文、令牌、Cookie、手机号、地址、文件 URL 或服务器堆栈。
- 四类布局为 `PublicLayout`、`AccountLayout`、`AdminLayout`、`ProductionLayout`；服务端岗位权限仍是最终授权边界。

## 部署和旧 URL

`deploy/nginx.app.conf` 明确让 `/api/*` 优先代理后端，`/app/*` 才使用 history fallback；指纹资产长期缓存，运行时配置禁止缓存。V0 不修改旧 URL。后续每个 V1-V5 批次必须在替代页验收后逐条增加旧 URL 302/下线映射，不能整站一次性切换。

## 可重复门禁

```powershell
cd frontend-vue
npm ci
npm run check
```

`check` 依次执行 ESLint/Prettier、严格类型检查、Vitest、生产构建、部署配置检查和桌面/移动 Playwright 冒烟。GitHub Actions 使用同一命令。

## V0 验收记录

2026-09-14 在 Node 22.16.0/npm 10.9.2 下执行 `npm run check`：ESLint/Prettier、严格类型检查、3 个 Vitest 单元测试、Vite 生产构建、`/api` 与 `/app` 部署边界检查全部通过；Playwright 在桌面与移动 Chromium 上执行 4 个应用壳/404 冒烟测试全部通过。`npm audit` 报告 0 个已知漏洞。
