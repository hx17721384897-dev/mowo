-- R1-B: physically retire community, creator self-service, online creator finance,
-- certification, bull-score and referral capabilities. This project has no
-- production data; retained orders, contracts, collab storefront, customization,
-- inventory, production and external-order import tables are intentionally untouched.

-- Remove records whose enum values are being retired before narrowing the enums.
DELETE FROM "action_tokens"
WHERE "action" IN ('WITHDRAW', 'CHANGE_PAYOUT_ACCOUNT');

BEGIN;
CREATE TYPE "ActionType_new" AS ENUM ('CHANGE_PASSWORD', 'CHANGE_PHONE');
ALTER TABLE "action_tokens"
  ALTER COLUMN "action" TYPE "ActionType_new"
  USING ("action"::text::"ActionType_new");
ALTER TYPE "ActionType" RENAME TO "ActionType_old";
ALTER TYPE "ActionType_new" RENAME TO "ActionType";
DROP TYPE "ActionType_old";
COMMIT;

DELETE FROM "sms_codes"
WHERE "purpose" IN ('STEP_UP_WITHDRAW', 'STEP_UP_CHANGE_PAYOUT');

BEGIN;
CREATE TYPE "SmsPurpose_new" AS ENUM (
  'LOGIN',
  'REGISTER',
  'RESET_PASSWORD',
  'BIND_PHONE',
  'DEACTIVATE',
  'STEP_UP_CHANGE_PASSWORD'
);
ALTER TABLE "sms_codes"
  ALTER COLUMN "purpose" TYPE "SmsPurpose_new"
  USING ("purpose"::text::"SmsPurpose_new");
ALTER TYPE "SmsPurpose" RENAME TO "SmsPurpose_old";
ALTER TYPE "SmsPurpose_new" RENAME TO "SmsPurpose";
DROP TYPE "SmsPurpose_old";
COMMIT;

ALTER TABLE "collab_works"
  DROP COLUMN "activity_id",
  DROP COLUMN "creator_markups",
  DROP COLUMN "is_exclusive_work",
  DROP COLUMN "is_newbie_work",
  DROP COLUMN "newbie_expired_at",
  DROP COLUMN "revenue_rate",
  DROP COLUMN "can_resubmit",
  DROP COLUMN "delist_requested_at",
  DROP COLUMN "delist_reason",
  DROP COLUMN "submission_batch_id",
  DROP COLUMN "is_revision",
  DROP COLUMN "original_work_id",
  DROP COLUMN "change_log";

CREATE INDEX "collab_works_storefront_recommended_idx"
  ON "collab_works"("status", "is_on_shelf", "shelf_status", "storefront_sort_order");
CREATE INDEX "collab_works_storefront_popular_idx"
  ON "collab_works"("status", "is_on_shelf", "shelf_status", "storefront_view_count");

ALTER TABLE "user_profiles"
  DROP COLUMN "article_count",
  DROP COLUMN "follower_count",
  DROP COLUMN "following_count",
  DROP COLUMN "liked_count",
  DROP COLUMN "notify_interaction",
  DROP COLUMN "notify_promo",
  DROP COLUMN "profile_visibility";

ALTER TABLE "users" DROP COLUMN "certify_status";

-- PlatformConfig remains because retained collab breach policy uses it. Remove only
-- retired bull/revenue records and make future generic records default to system.
DELETE FROM "platform_configs"
WHERE "group_name" IN ('bull', 'revenue');
ALTER TABLE "platform_configs"
  ALTER COLUMN "group_name" SET DEFAULT 'system';

-- Drop dependent tables before their parents so no CASCADE is required.
DROP TABLE "article_products";
DROP TABLE "comments";
DROP TABLE "collects";
DROP TABLE "articles";
DROP TABLE "earnings";
DROP TABLE "orders_ext";
DROP TABLE "products";
DROP TABLE "animation_frames";
DROP TABLE "animations";
DROP TABLE "reserve_logs";
DROP TABLE "collab_orders";
DROP TABLE "creator_reserves";
DROP TABLE "referral_clicks";
DROP TABLE "creator_referral_links";
DROP TABLE "balances";
DROP TABLE "withdrawal_requests";
DROP TABLE "settlement_records";
DROP TABLE "bull_score_logs";
DROP TABLE "bull_scores";
DROP TABLE "certify_applications";
DROP TABLE "collab_activities";
DROP TABLE "creator_notifications";
DROP TABLE "creator_profiles";
DROP TABLE "creator_social_links";
DROP TABLE "credit_logs";
DROP TABLE "credit_scores";
DROP TABLE "follows";
DROP TABLE "likes";
DROP TABLE "reports";
DROP TABLE "platform_rules";
