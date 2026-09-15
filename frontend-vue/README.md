# 哞屋 Web（Vue）

当前完成 V0 基础架构、V1a 官网静态页面与 V1b 联名货架。应用固定运行在 `/app/`；联名列表和详情使用 `/app/showcase*`，私人定制和联络在后续迁移前仍通过 `legacyWebBase` 交接到旧页面。

## 本地运行

先在项目根目录启动 API 与旧页面服务：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\local.ps1 start
```

再打开一个终端启动 Vue：

```powershell
cd frontend-vue
npm.cmd run dev
```

访问 `http://127.0.0.1:5173/app/`。Vite 只在开发环境将 `/api/*` 代理到本地 3001 API，并将 `/mowo/frontend/*` 代理到旧页面服务；生产地址必须由部署环境注入 `public/runtime-config.js`，不能把密钥写入前端。

停止时在 Vue 终端按 `Ctrl+C`，再在项目根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\local.ps1 stop
```

## 验证

```powershell
npm ci
npm run check
```

`check` 依次执行格式、类型、单元测试、生产构建、部署规则和桌面/移动端浏览器回归。旧 URL 的临时 302 与兼容规则见 `deploy/nginx.v1a-redirects.conf`；V1b 详细记录见 `../docs/V1B_COLLAB_STOREFRONT_MIGRATION.md`。
