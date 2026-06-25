import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { POST_TYPE_HASHTAGS } from "../posts";
import type { PostType } from "@/generated/prisma/client";

// Claude (claude-opus-4-8) — аналіз стилю каналу, Telegram-оформлення,
// добір хештегів, генерація контент-плану. Ключ — per-tenant.

const MODEL = "claude-opus-4-8";

function client(apiKey: string) {
  return new Anthropic({ apiKey });
}

/** Витягує перший JSON-обʼєкт/масив із тексту відповіді. */
function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const m = trimmed.match(/[[{][\s\S]*[\]}]/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error("Не вдалося розпарсити JSON з відповіді Claude");
  }
}

async function ask(apiKey: string, system: string, user: string, maxTokens = 2000) {
  const res = await client(apiKey).messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  const block = res.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
}

export type StyleAnalysis = {
  tone: string;
  emojiUsage: string;
  avgLength: string;
  structure: string;
  ctaStyle: string;
  rubrics: string[];
  language: string;
  summary: string;
};

/** Аналіз стилю каналу з вибірки постів (+ опційна тематика). */
export async function analyzeStyle(
  apiKey: string,
  samples: string[],
  topic?: string,
): Promise<StyleAnalysis> {
  const system =
    "Ты — аналитик контента Telegram-каналов. По примерам постов опиши стиль канала. " +
    "Ответь СТРОГО валидным JSON без markdown-обёртки с полями: " +
    "tone, emojiUsage, avgLength, structure, ctaStyle, rubrics (массив строк), language, summary.";
  const user =
    (topic ? `Тематика канала: ${topic}\n\n` : "") +
    `Примеры постов (${samples.length}):\n\n` +
    samples.map((s, i) => `[${i + 1}]\n${s}`).join("\n\n---\n\n");
  const text = await ask(apiKey, system, user, 1500);
  return extractJson<StyleAnalysis>(text);
}

export type BrandKit = {
  palette: string[]; // hex-кольори
  style: string; // візуальний стиль
  composition: string;
  hasTextOnImage: boolean;
  logo: boolean;
  mood: string;
  summary: string;
};

/** Аналіз зображень каналу (Claude Vision) → кольорогама + айдентика. */
export async function analyzeImages(
  apiKey: string,
  images: { b64: string; mime: string }[],
): Promise<BrandKit> {
  const imgs = images.slice(0, 5);
  const content: Anthropic.MessageParam["content"] = [
    ...imgs.map((im) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: (im.mime || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: im.b64,
      },
    })),
    {
      type: "text" as const,
      text:
        "Проанализируй визуальную айдентику этих постов Telegram-канала. " +
        "Ответь СТРОГО валидным JSON без markdown: " +
        "{palette (массив 3-6 hex-цветов), style, composition, hasTextOnImage (bool), logo (bool), mood, summary}.",
    },
  ];
  const res = await client(apiKey).messages.create({
    model: MODEL,
    max_tokens: 1000,
    messages: [{ role: "user", content }],
  });
  const block = res.content.find((b) => b.type === "text");
  return extractJson<BrandKit>(block && block.type === "text" ? block.text : "{}");
}

export type FormattedPost = {
  bodyHtml: string;
  hashtags: string[];
  buttonLabel: string;
};

/**
 * Оформлення поста під Telegram: бере чернетку тексту + стиль каналу й повертає
 * готовий Telegram-HTML (теги b/i/u/s/a/code/blockquote), хештеги та підпис
 * синьої CTA-кнопки. CTA-посилання підставляється в кнопку окремо при публікації.
 */
export async function formatPost(
  apiKey: string,
  opts: {
    type: PostType;
    draftText: string;
    style?: StyleAnalysis | null;
    topic?: string;
    includeCta: boolean;
    ctaLabel?: string;
    ctaUrl?: string;
    examples?: string[]; // few-shot приклади постів каналу
    forMedia?: boolean; // якщо пост іде з картинкою — підпис ≤1000 символів
  },
): Promise<FormattedPost> {
  const defaultTags = POST_TYPE_HASHTAGS[opts.type].join(" ");
  const ctaRule = opts.includeCta
    ? `Внизу поста добавь короткий призыв к действию с гиперссылкой «${opts.ctaLabel}» на CTA-URL (тег <a href="CTA_URL">…</a>).`
    : "НЕ добавляй никаких призывов к действию и ссылок «написать нам» — кнопка выключена.";
  const lenRule = opts.forMedia
    ? "Пост идёт ОДНИМ сообщением с картинкой — держи длину bodyHtml ≤ 1000 символов."
    : "Держи длину bodyHtml ≤ 3500 символов.";
  const system =
    "Ты — редактор Telegram-канала. Оформи пост ТОЧНО в стиле канала (тон, длина, эмодзи, структура). " +
    "Используй ТОЛЬКО Telegram-HTML теги: <b> <i> <u> <s> <a href> <code> <pre> <blockquote>. " +
    "НЕ используй markdown, <br>, <p>, <div>, заголовки. Переносы строк — обычные \\n. " +
    `${ctaRule} ${lenRule} ` +
    "Подбери уместные хештеги (включи дефолтные для типа). " +
    "Ответь СТРОГО валидным JSON без markdown: {bodyHtml, hashtags (массив строк с #), buttonLabel}.";
  const user = [
    `Тип поста: ${opts.type} (дефолтные хештеги: ${defaultTags})`,
    opts.topic ? `Тема: ${opts.topic}` : "",
    opts.style ? `Стиль канала (JSON): ${JSON.stringify(opts.style)}` : "",
    opts.examples?.length
      ? `Примеры постов канала (повтори их tone of voice):\n\n${opts.examples.slice(0, 3).join("\n\n---\n\n")}`
      : "",
    opts.includeCta ? `CTA: текст кнопки = "${opts.ctaLabel}", CTA_URL = ${opts.ctaUrl}` : "",
    `Черновик текста:\n${opts.draftText}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const text = await ask(apiKey, system, user, 2500);
  const parsed = extractJson<FormattedPost>(text);
  // гарантуємо дефолтні хештеги типу
  const tags = new Set([...(parsed.hashtags ?? []), ...POST_TYPE_HASHTAGS[opts.type]]);
  return {
    bodyHtml: parsed.bodyHtml ?? opts.draftText,
    hashtags: [...tags],
    buttonLabel: parsed.buttonLabel || opts.ctaLabel || "Написать нам",
  };
}

export type PlanItem = { dayOffset: number; topic: string; type: PostType };

/** Генерує контент-план на N днів у стилі каналу. */
export async function generateContentPlan(
  apiKey: string,
  opts: { style?: StyleAnalysis | null; topic?: string; days: number },
): Promise<PlanItem[]> {
  const system =
    "Ты — контент-стратег Telegram-канала рекламного агентства (трафик). " +
    "Составь контент-план. Чередуй типы: news, case, review, about, update, blog, fun, info. " +
    "Ответь СТРОГО валидным JSON-массивом без markdown: " +
    "[{dayOffset (число, 0=сегодня), topic (строка), type (один из перечисленных)}].";
  const user = [
    opts.topic ? `Тематика: ${opts.topic}` : "",
    opts.style ? `Стиль канала: ${JSON.stringify(opts.style)}` : "",
    `Дней: ${opts.days}. По одному посту в день.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const text = await ask(apiKey, system, user, 2000);
  return extractJson<PlanItem[]>(text);
}
