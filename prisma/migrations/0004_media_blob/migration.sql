-- Персистентне сховище медіа в БД.
CREATE TABLE IF NOT EXISTS "MediaBlob" (
    "id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaBlob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MediaBlob_createdAt_idx" ON "MediaBlob"("createdAt");
