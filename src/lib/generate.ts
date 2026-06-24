import "server-only";
import { prisma } from "./db";
import { resolveApiKey, chargeCredits } from "./ai/keys";
import { generateDraftText, generateImage } from "./ai/openai";
import { formatPost, type StyleAnalysis } from "./ai/anthropic";
import { getContactCta, getDefaultChannel } from "./tenant";
import { putMedia } from "./media";
import type { PostType } from "@/generated/prisma/client";

async function loadStyle(tenantId: string): Promise<StyleAnalysis | null> {
  const sp = await prisma.styleProfile.findUnique({ where: { tenantId } });
  if (!sp?.analysisJson) return null;
  try {
    return JSON.parse(sp.analysisJson) as StyleAnalysis;
  } catch {
    return null;
  }
}

/**
 * Створює чернетку поста: GPT пише текст (якщо не передано власний),
 * Claude оформляє в Telegram-HTML + хештеги + CTA. Пост зберігається у
 * статусі awaiting_approval. Повертає id поста.
 */
export async function createDraft(opts: {
  tenantId: string;
  type: PostType;
  topic: string;
  ownText?: string; // якщо власник дав свій текст — GPT пропускаємо
  extra?: string;
}): Promise<{ id: string; bodyHtml: string; hashtags: string[] } | { error: string }> {
  const { tenantId, type, topic } = opts;

  const anthropicKey = await resolveApiKey(tenantId, "anthropic");
  if (!anthropicKey) return { error: "Немає Anthropic API-ключа (адмінка → ключі)" };

  const style = await loadStyle(tenantId);

  let draftText = opts.ownText?.trim() || "";
  let generatedBy: "gpt" | "manual" = opts.ownText ? "manual" : "gpt";
  if (!draftText) {
    const openaiKey = await resolveApiKey(tenantId, "openai");
    if (!openaiKey) return { error: "Немає OpenAI API-ключа (адмінка → ключі)" };
    draftText = await generateDraftText(openaiKey, { type, topic, style, extra: opts.extra });
    await chargeCredits(tenantId, 1, "post_text", { type });
  }

  const cta = await getContactCta(tenantId);
  const formatted = await formatPost(anthropicKey, {
    type,
    draftText,
    style,
    topic,
    ctaLabel: cta.label,
    ctaUrl: cta.url,
  });
  await chargeCredits(tenantId, 1, "post_format", { type });

  const channel = await getDefaultChannel(tenantId);

  const post = await prisma.post.create({
    data: {
      tenantId,
      channelId: channel?.id ?? null,
      type,
      status: "awaiting_approval",
      topic,
      bodyHtml: formatted.bodyHtml,
      hashtagsJson: JSON.stringify(formatted.hashtags),
      buttonsJson: JSON.stringify([{ label: formatted.buttonLabel, url: cta.url }]),
      generatedBy,
    },
  });

  return { id: post.id, bodyHtml: formatted.bodyHtml, hashtags: formatted.hashtags };
}

/** Перегенерувати чернетку (той самий тип/тему), оновити той самий пост. */
export async function regenerateDraft(
  postId: string,
): Promise<{ ok: true } | { error: string }> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return { error: "Пост не знайдено" };
  const anthropicKey = await resolveApiKey(post.tenantId, "anthropic");
  const openaiKey = await resolveApiKey(post.tenantId, "openai");
  if (!anthropicKey || !openaiKey) return { error: "Немає API-ключів (адмінка → ключі)" };

  const style = await loadStyle(post.tenantId);
  const draftText = await generateDraftText(openaiKey, {
    type: post.type,
    topic: post.topic ?? "",
    style,
  });
  await chargeCredits(post.tenantId, 1, "post_text");
  const cta = await getContactCta(post.tenantId);
  const formatted = await formatPost(anthropicKey, {
    type: post.type,
    draftText,
    style,
    topic: post.topic ?? undefined,
    ctaLabel: cta.label,
    ctaUrl: cta.url,
  });
  await chargeCredits(post.tenantId, 1, "post_format");
  await prisma.post.update({
    where: { id: postId },
    data: {
      bodyHtml: formatted.bodyHtml,
      hashtagsJson: JSON.stringify(formatted.hashtags),
      buttonsJson: JSON.stringify([{ label: formatted.buttonLabel, url: cta.url }]),
      generatedBy: "gpt",
    },
  });
  return { ok: true };
}

/** Оформити власний текст автора (без GPT) і оновити пост. */
export async function setOwnText(
  postId: string,
  ownText: string,
): Promise<{ ok: true } | { error: string }> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return { error: "Пост не знайдено" };
  const anthropicKey = await resolveApiKey(post.tenantId, "anthropic");
  if (!anthropicKey) return { error: "Немає Anthropic API-ключа" };
  const style = await loadStyle(post.tenantId);
  const cta = await getContactCta(post.tenantId);
  const formatted = await formatPost(anthropicKey, {
    type: post.type,
    draftText: ownText,
    style,
    topic: post.topic ?? undefined,
    ctaLabel: cta.label,
    ctaUrl: cta.url,
  });
  await chargeCredits(post.tenantId, 1, "post_format");
  await prisma.post.update({
    where: { id: postId },
    data: {
      bodyHtml: formatted.bodyHtml,
      hashtagsJson: JSON.stringify(formatted.hashtags),
      buttonsJson: JSON.stringify([{ label: formatted.buttonLabel, url: cta.url }]),
      generatedBy: "manual",
    },
  });
  return { ok: true };
}

/** Генерує зображення під пост і привʼязує його (mediaType=image). */
export async function attachGeneratedImage(
  postId: string,
): Promise<{ ok: true } | { error: string }> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return { error: "Пост не знайдено" };
  const openaiKey = await resolveApiKey(post.tenantId, "openai");
  if (!openaiKey) return { error: "Немає OpenAI API-ключа" };

  const prompt = `Иллюстрация для Telegram-поста рекламного агентства (трафик/реклама). Тема: ${
    post.topic ?? ""
  }. Современный, чистый стиль, без текста на картинке.`;
  try {
    const img = await generateImage(openaiKey, prompt);
    const key = await putMedia(Buffer.from(img.b64, "base64"), img.mime);
    await chargeCredits(post.tenantId, 3, "post_image");
    await prisma.post.update({
      where: { id: postId },
      data: { mediaType: "image", mediaRef: key, mediaMime: img.mime },
    });
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
