# V1a 官网静态页面迁移记录

> 状态：架构迁移及视觉纠偏均已完成自动验收；等待负责人按第 5 节统一视觉复验。
>
> 后续更新（2026-09-15）：联名交接已由 V1b 完成；公共页面视觉返工、当前自动门禁和提交记录以 `VUE_VISUAL_FIDELITY_REMEDIATION_PLAN.md` 为准。

## 1. 本阶段边界

Vue 正式接管公共布局、导航、页脚、首页、关于、产品介绍、FAQ、用户协议、隐私政策和公共 404。联名数据流属于 V1b，联络表单与附件属于 V1c，私人定制属于 V2；这些保留功能在当前阶段只通过 `legacyWebBase` 交接，不复制业务逻辑。

本阶段没有迁入旧页面中的虚构用户评价、假社交账号、全球配送、七天无理由退换、随时客服、具体未确认材质/帧数/价格/交期等文案。社区、线上分红、提现、牛量和创作者自助没有入口。

## 2. 路由与临时切换

| 旧地址 | Vue 地址 | 临时状态 | 回退方式 |
|---|---|---|---|
| `/mowo/frontend/pages/index.html` | `/app/` | 302 验证窗口 | 移除对应 Nginx location，恢复旧 HTML |
| `/mowo/frontend/pages/about.html` | `/app/about` | 302 验证窗口 | 同上 |
| `/mowo/frontend/pages/products.html` | `/app/products` | 302 验证窗口 | 同上 |
| `/mowo/frontend/pages/faq.html` | `/app/faq` | 302 验证窗口 | 同上 |
| `/mowo/frontend/pages/user-agreement.html` | `/app/legal/terms` | 302 验证窗口 | 同上 |
| `/mowo/frontend/pages/privacy-policy.html` | `/app/legal/privacy` | 302 验证窗口 | 同上 |

执行配置为 `frontend-vue/deploy/nginx.v1a-redirects.conf`。V1a 不删除上述旧文件；V6 在稳定窗口、链接扫描和回退审批通过后再删除并决定永久重定向状态码。

## 3. 尚未迁移入口

| 能力 | 当前交接文件 | 后续阶段 |
|---|---|---|
| 联名商品 | `showcase.html` | V1b |
| 私人定制 | `customize-start.html` | V2 |
| 联络表单 | `contact.html` | V1c |

入口基址由公开运行时配置 `legacyWebBase` 提供；默认同源路径为 `/mowo/frontend/pages`。它不是权限边界，旧业务接口仍须由后端认证、对象归属和岗位权限保护。

## 4. 初始架构迁移证据

- `frontend-vue npm run check` 全部通过：ESLint、Prettier、严格类型检查、5 项单元测试、生产构建、部署边界检查和 10 项 Chromium 浏览器检查。
- 浏览器检查覆盖桌面与 Pixel 7：六个 Vue 静态路由、公共导航/页脚、FAQ 搜索、协议草案警告、404、移动菜单及横向溢出。
- 部署检查验证 `/api/*` 不被 Vue fallback 吞掉、六条旧地址均为可撤回 302，且联名、定制、联络三个交接文件真实存在。
- 静态内容测试禁止重新出现“全球配送”“7 天无理由”“牛量积分”“可提现余额”等旧承诺。

本节只记录 2026-09-14 的架构迁移门禁，不作为视觉一致性证据；最终视觉对照见返工计划。

## 5. 负责人手工复验

运行与反馈要求见本次阶段交付说明。人工重点确认品牌文案与视觉偏好；不要在这一阶段测试 V1b/V1c/V2 尚未迁移的业务内部流程，只确认三个按钮能正确交接到保留旧页面。
