-- CTA опційна + режим бота + brandKit (візуальна айдентика).
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "ctaEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "pendingMode" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "pendingModeAt" TIMESTAMP(3);
ALTER TABLE "StyleProfile" ADD COLUMN IF NOT EXISTS "brandKitJson" TEXT;
