-- Окремий ToV банера + референс, пак емодзі, дефолтні хештеги per-тематика.
ALTER TABLE "StyleProfile" ADD COLUMN IF NOT EXISTS "bannerTov" TEXT;
ALTER TABLE "StyleProfile" ADD COLUMN IF NOT EXISTS "refBannerKey" TEXT;
ALTER TABLE "StyleProfile" ADD COLUMN IF NOT EXISTS "emojiPackJson" TEXT;
ALTER TABLE "StyleProfile" ADD COLUMN IF NOT EXISTS "premiumEmojiJson" TEXT;

CREATE TABLE IF NOT EXISTS "HashtagPreset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "PostType" NOT NULL,
    "tagsJson" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HashtagPreset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "HashtagPreset_tenantId_type_key" ON "HashtagPreset"("tenantId", "type");
ALTER TABLE "HashtagPreset" ADD CONSTRAINT "HashtagPreset_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
