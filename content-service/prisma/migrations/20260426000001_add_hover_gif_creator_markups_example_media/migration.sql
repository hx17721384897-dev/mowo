-- AlterTable collab_works: add hoverGifUrl and creatorMarkups
ALTER TABLE "collab_works" ADD COLUMN IF NOT EXISTS "hover_gif_url" TEXT;
ALTER TABLE "collab_works" ADD COLUMN IF NOT EXISTS "creator_markups" TEXT;

-- AlterTable machine_model_skus: add exampleMedia
ALTER TABLE "machine_model_skus" ADD COLUMN IF NOT EXISTS "example_media" TEXT;
