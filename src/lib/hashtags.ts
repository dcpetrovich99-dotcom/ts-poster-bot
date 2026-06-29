import "server-only";
import { prisma } from "./db";
import { POST_TYPE_HASHTAGS, parseJsonArray } from "./posts";
import type { PostType } from "@/generated/prisma/client";

// Дефолтні хештеги під тематику поста. Якщо власник не задав свій пресет —
// беремо вшиті дефолти (POST_TYPE_HASHTAGS).

export async function getHashtagPreset(tenantId: string, type: PostType): Promise<string[]> {
  const row = await prisma.hashtagPreset.findUnique({
    where: { tenantId_type: { tenantId, type } },
  });
  if (row) {
    const tags = parseJsonArray<string>(row.tagsJson);
    if (tags.length) return tags;
  }
  return POST_TYPE_HASHTAGS[type];
}

export function normalizeTags(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));
}

export async function setHashtagPreset(tenantId: string, type: PostType, tags: string[]) {
  await prisma.hashtagPreset.upsert({
    where: { tenantId_type: { tenantId, type } },
    create: { tenantId, type, tagsJson: JSON.stringify(tags) },
    update: { tagsJson: JSON.stringify(tags) },
  });
}

export async function getAllPresets(tenantId: string): Promise<Record<string, string[]>> {
  const rows = await prisma.hashtagPreset.findMany({ where: { tenantId } });
  const map: Record<string, string[]> = {};
  for (const r of rows) map[r.type] = parseJsonArray<string>(r.tagsJson);
  return map;
}
