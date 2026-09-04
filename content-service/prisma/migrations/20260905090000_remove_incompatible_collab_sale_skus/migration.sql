-- 上一批旧 JSON 配置迁移时没有按动画核心帧重新校验 SKU。
-- 清理这类无效销售项；动画、SKU 和作品源数据均不删除。
DELETE FROM "collab_sale_skus" sale
USING "collab_works" work,
      "animation_asset_versions" version,
      "machine_model_skus" sku
WHERE sale."collab_work_id" = work."id"
  AND work."animation_version_id" = version."id"
  AND sale."sku_id" = sku."id"
  AND (
    version."base_frame_count" <= 0
    OR sku."frame_count" < version."base_frame_count"
    OR MOD(sku."frame_count", version."base_frame_count") <> 0
  );
