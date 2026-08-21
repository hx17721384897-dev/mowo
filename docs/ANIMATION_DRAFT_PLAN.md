# 动画工程文件存储 — 迭代计划

> 阅读提醒（2026-08-21）：本文主要记录旧 `CustomProduct` 草稿和工程文件的短期实现，草稿保存期限不等于正式动画资产保存期限。后续目标是把临时草稿、可复购动画资产和不可变动画版本分开；已确认规则及编号见 `ANIMATION_ORDER_PRODUCTION_FRAMEWORK.md`。本文中的旧实现信息保留用于迁移对照，不应覆盖新框架。

> 记录时间：2026-04-20  
> 当前阶段：**短期方案已上线**，OSS 迁移方案待实施

---

## 背景与问题

用户在 `customize-editor.html` 上传视频后会提取大量原始帧（例如 100 帧），然后从中筛选出目标帧数（例如 12 帧）传给 `customize-confirm.html`。

用户希望能「重新编辑」——即回到 100 帧的筛帧界面，重新选择。

### 存储压力估算

| 场景 | 单帧 base64 | 100 帧工程文件 | 每用户 3 草稿 |
|------|------------|--------------|-------------|
| 400×400 JPEG | ~100 KB | ~10 MB | ~30 MB |
| 800×800 PNG | ~400 KB | ~40 MB | ~120 MB |
| 1000 活跃用户 | — | — | **30–120 GB in DB** |

将 base64 大文本直接存 PostgreSQL 不可行，会严重拖慢查询并推高成本。

---

## 短期方案（已实施）

### 1. 草稿数量上限

**文件**：`content-service/src/routes/custom-products.js`

- 普通用户：活跃草稿 ≤ **3 个**（status = `draft` 或 `in_cart`）
- 认证创作者（certifyStatus ≥ 2）：≤ **10 个**
- 超出上限时 HTTP 400，错误码 `DRAFT_LIMIT_REACHED`，提示用户到「我的动画」删除旧草稿

### 2. 工程元数据（draftData）

**文件**：`frontend/pages/customize-confirm.html` → `_createCustomProducts()`

短期的 `draftData` 是轻量元数据，**不重复存储帧图**：

```json
{
  "version": 1,
  "source": "customize-confirm",
  "savedAt": "2026-04-20T12:00:00.000Z",
  "frameCount": 12,
  "totalSourceFrames": null,
  "modelId": "xxx",
  "modelName": "标准款"
}
```

> `animationFrames` 字段已存储最终选定的帧图（base64），`draftData` 不再重复。

### 3. 短期「重新编辑」的局限

- 点「重新编辑」可以加载 `animationFrames` 中保存的已选帧（12 帧）进行调整
- **无法**还原到 100 帧的原始选帧界面（原始素材已在用户提交时清除）
- 这是可接受的短期降级体验，完整还原见下方 OSS 方案

---

## OSS 迁移方案（待实施）

### 目标

用户「重新编辑」时，能看到所有原始帧（100 帧），且之前的选中状态还在。

### 架构变更

```
旧流程：
  提取帧 → base64 存 localStorage → 筛帧 → base64 传后端 → 存 PostgreSQL text 字段

新流程：
  提取帧 → 每帧上传 OSS（预签名 PUT）→ 存 OSS key 列表到 localStorage
          → 筛帧 → 选中帧的 OSS key 列表 + 工程文件 JSON 上传 OSS
          → 后端存 OSS 路径（几十字节），不存 base64
```

### 具体改动

#### Step 1：`customize-editor.html` — 帧提取时直接上传 OSS

```javascript
// 每提取一帧后，立即预签名上传，替换 base64 为 OSS key
async function uploadFrameToOSS(base64DataUrl, frameIndex) {
  const blob = dataUrlToBlob(base64DataUrl);
  const presignRes = await fetch(`${API}/api/upload/presign`, {
    method: 'POST',
    body: JSON.stringify({ filename: `frame_${frameIndex}.jpg`, contentType: 'image/jpeg' })
  });
  const { uploadUrl, ossKey } = await presignRes.json().data;
  await fetch(uploadUrl, { method: 'PUT', body: blob });
  return ossKey;  // 存这个，不存 base64
}
```

localStorage 中存的改为 OSS key 列表，而非 base64 数组。

#### Step 2：工程文件上传 OSS

```javascript
// 用户确认选帧后，生成工程文件并上传到 OSS
const projectJson = JSON.stringify({
  version: 2,
  allFrameKeys: [...],     // 全部 100 帧的 OSS key
  selectedIndices: [0,5,12,...],  // 用户勾选的帧索引
  meta: { modelId, modelName }
});
// 上传 projectJson 为 OSS 文件，得到 draftOssKey
// CustomProduct.draftData = draftOssKey  （只存路径！）
```

#### Step 3：后端 GET /api/custom-products 返回预签名 URL

```javascript
// 列表接口：返回 firstFrameSignedUrl 供缩略图展示
// 详情接口：返回 draftDataSignedUrl 供编辑器加载
const draftDataSignedUrl = cp.draftData
  ? fastify.ossPresignGet(cp.draftData, 3600)
  : null;
```

#### Step 4：`customize-editor.html` 支持 `?productId=xxx` 参数

```javascript
// 初始化时检查 URL 参数
const productId = new URLSearchParams(location.search).get('productId');
if (productId) {
  const cp = await fetch(`${API}/api/custom-products/${productId}`);
  // 从 cp.draftData（OSS URL）加载工程文件
  // 恢复所有帧 + 高亮已选帧
}
```

#### Step 5：OSS 生命周期规则

```
Bucket 生命周期规则：
- 路径前缀 drafts/frames/ → 7 天后自动删除
- 路径前缀 drafts/projects/ → 7 天后自动删除
```

后端定时任务同步清理过期 `CustomProduct` 记录（status=removed）。

### 存储成本对比

| 方案 | 存储位置 | 1000 用户 × 3 草稿 × 100 帧 | 月成本估算 |
|------|---------|--------------------------|----------|
| 短期（base64 in DB） | PostgreSQL text | 30–120 GB | 高（DB 存储昂贵） |
| OSS 方案 | OSS + DB 存路径 | DB < 1MB，OSS ≈ 30 GB | ~¥3.6/月（OSS ¥0.12/GB） |

---

## 实施优先级

| 任务 | 优先级 | 依赖 |
|------|--------|------|
| 草稿上限（已完成）| P0 | — |
| draftData 元数据（已完成）| P0 | — |
| 编辑器帧直传 OSS | P1 | OSS 上传权限配置 |
| 工程文件上传 OSS | P1 | 编辑器帧直传完成 |
| 编辑器加载 productId | P1 | 工程文件 OSS |
| OSS 生命周期规则 | P2 | 服务器部署 |
| 定时清理过期草稿 | P2 | 服务器部署 |

---

## 相关文件

| 文件 | 作用 |
|------|------|
| `content-service/src/routes/custom-products.js` | 草稿 CRUD + 上限校验 |
| `frontend/pages/customize-editor.html` | 帧提取 + 筛选（待改造为 OSS 直传）|
| `frontend/pages/customize-confirm.html` | 调用 `_createCustomProducts()` 保存工程 |
| `frontend/pages/my-animations.html` | 普通用户查看草稿 + 「重新编辑」入口 |
| `frontend/pages/creator-animations.html` | 创作者查看草稿 + 「重新编辑」入口 |
