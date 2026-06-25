import "server-only";
import { prisma } from "./db";
import { getMedia, putMedia } from "./media";
import { parseJsonArray } from "./posts";
import { resolveApiKey } from "./ai/keys";
import { analyzeStyle, analyzeImages } from "./ai/anthropic";

// Навчання стилю каналу: накопичення зразків (текст+фото), аналіз tone of voice
// (Claude) + візуальної айдентики/палітри (Claude Vision).

const MAX_TEXTS = 20;
const MAX_IMAGES = 8;

async function ensureProfile(tenantId: string) {
  return prisma.styleProfile.upsert({
    where: { tenantId },
    create: { tenantId, source: "manual" },
    update: {},
  });
}

/** Старт режиму навчання: чистимо попередні зразки, ставимо pendingMode. */
export async function startLearn(tenantId: string) {
  await ensureProfile(tenantId);
  await prisma.styleProfile.update({
    where: { tenantId },
    data: { referencesJson: JSON.stringify([]), refImagesJson: JSON.stringify([]), samplesCount: 0 },
  });
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { pendingMode: "learn", pendingModeAt: new Date() },
  });
}

export async function isLearning(tenantId: string): Promise<boolean> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  return t?.pendingMode === "learn";
}

/** Додати один зразок (текст і/або ключ зображення у Blobs). */
export async function addLearnSample(
  tenantId: string,
  sample: { text?: string; imageKey?: string },
): Promise<{ texts: number; images: number }> {
  const sp = await ensureProfile(tenantId);
  const texts = parseJsonArray<string>(sp.referencesJson);
  const images = parseJsonArray<string>(sp.refImagesJson);
  if (sample.text && sample.text.trim().length > 10 && texts.length < MAX_TEXTS) {
    texts.push(sample.text.trim());
  }
  if (sample.imageKey && images.length < MAX_IMAGES) {
    images.push(sample.imageKey);
  }
  await prisma.styleProfile.update({
    where: { tenantId },
    data: {
      referencesJson: JSON.stringify(texts),
      refImagesJson: JSON.stringify(images),
      samplesCount: texts.length,
    },
  });
  return { texts: texts.length, images: images.length };
}

/** Завершити навчання: аналіз тексту + зображень → analysisJson + brandKitJson. */
export async function finalizeLearn(
  tenantId: string,
): Promise<{ ok: true; toneSummary: string; brandSummary: string } | { error: string }> {
  const key = await resolveApiKey(tenantId, "anthropic");
  if (!key) return { error: "Немає Anthropic API-ключа (адмінка → ключі)" };

  const sp = await ensureProfile(tenantId);
  const texts = parseJsonArray<string>(sp.referencesJson);
  const imageKeys = parseJsonArray<string>(sp.refImagesJson);
  if (!texts.length && !imageKeys.length) {
    return { error: "Нет образцов. Пришли посты (текст/фото) и повтори /done." };
  }

  let toneSummary = "";
  let brandSummary = "";
  const data: { analysisJson?: string; brandKitJson?: string; source: "scrape" | "manual" | "hybrid" } = {
    source: "manual",
  };

  if (texts.length) {
    const analysis = await analyzeStyle(key, texts, sp.topic ?? undefined);
    data.analysisJson = JSON.stringify(analysis);
    toneSummary = analysis.summary;
  }

  if (imageKeys.length) {
    const images: { b64: string; mime: string }[] = [];
    for (const k of imageKeys.slice(0, 5)) {
      const m = await getMedia(k);
      if (m) images.push({ b64: m.data.toString("base64"), mime: m.mime });
    }
    if (images.length) {
      const brand = await analyzeImages(key, images);
      data.brandKitJson = JSON.stringify(brand);
      brandSummary = `${brand.summary} Палитра: ${(brand.palette ?? []).join(", ")}`;
    }
  }

  await prisma.styleProfile.update({ where: { tenantId }, data });
  await prisma.tenant.update({ where: { id: tenantId }, data: { pendingMode: null, pendingModeAt: null } });
  return { ok: true, toneSummary, brandSummary };
}

// ─── скрейп публічного каналу через t.me/s/<username> ───────────────

function tmeUsername(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@/, "")
    .replace(/^s\//, "")
    .split(/[/?#]/)[0];
}

/** Парсить веб-превʼю публічного каналу: тексти + URL зображень. */
export async function scrapeTmePublic(
  raw: string,
  maxPosts = 40,
): Promise<{ texts: string[]; imageUrls: string[] }> {
  const username = tmeUsername(raw);
  const texts: string[] = [];
  const imageUrls: string[] = [];
  const res = await fetch(`https://t.me/s/${username}`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; TGPosterBot/1.0)" },
  });
  if (!res.ok) return { texts, imageUrls };
  const html = await res.text();

  // Тексти постів.
  const textRe = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = textRe.exec(html)) && texts.length < maxPosts) {
    const clean = m[1]
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
    if (clean.length > 10) texts.push(clean);
  }

  // URL зображень (background-image у фото-обгортках).
  const imgRe = /background-image:url\('([^']+)'\)/g;
  while ((m = imgRe.exec(html)) && imageUrls.length < 8) {
    const url = m[1];
    if (/cdn|telesco|telegram/i.test(url)) imageUrls.push(url);
  }

  return { texts, imageUrls };
}

/** Навчання за публічним посиланням: скрейп → завантаження картинок → аналіз. */
export async function learnFromLink(
  tenantId: string,
  link: string,
): Promise<{ ok: true; texts: number; images: number; toneSummary: string } | { error: string }> {
  const { texts, imageUrls } = await scrapeTmePublic(link);
  if (!texts.length && !imageUrls.length) {
    return { error: "Не удалось получить посты. Канал публичный? Проверь @username." };
  }
  await startLearn(tenantId);
  for (const t of texts) await addLearnSample(tenantId, { text: t });
  for (const url of imageUrls.slice(0, 5)) {
    try {
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const key = await putMedia(buf, "image/jpeg");
      await addLearnSample(tenantId, { imageKey: key });
    } catch {}
  }
  const fin = await finalizeLearn(tenantId);
  if ("error" in fin) return fin;
  return { ok: true, texts: texts.length, images: Math.min(imageUrls.length, 5), toneSummary: fin.toneSummary };
}
