import "server-only";
import OpenAI from "openai";
import type { StyleAnalysis } from "./anthropic";
import type { PostType } from "@/generated/prisma/client";
import { POST_TYPE_LABEL } from "../posts";

// GPT (OpenAI) — генерація чернетки тексту поста + зображення (gpt-image-1).
// Ключ — per-tenant.

const TEXT_MODEL = "gpt-4o";
const IMAGE_MODEL = "gpt-image-1";

function client(apiKey: string) {
  return new OpenAI({ apiKey });
}

/** Генерує чернетку тексту поста в стилі каналу (без HTML-оформлення). */
export async function generateDraftText(
  apiKey: string,
  opts: {
    type: PostType;
    topic: string;
    style?: StyleAnalysis | null;
    extra?: string;
    examples?: string[];
  },
): Promise<string> {
  const system =
    "Ты — копирайтер Telegram-канала рекламного агентства (трафик/реклама). " +
    "Пиши живой, полезный пост ТОЧНО в стиле канала (тон, длина, эмодзи, структура из примеров). " +
    "Без хэштегов и без HTML — только текст.";
  const user = [
    `Тип поста: ${POST_TYPE_LABEL[opts.type]}`,
    `Тема: ${opts.topic}`,
    opts.style ? `Стиль канала (JSON): ${JSON.stringify(opts.style)}` : "",
    opts.examples?.length
      ? `Примеры постов канала (повтори их tone of voice, длину и структуру):\n\n${opts.examples
          .slice(0, 3)
          .join("\n\n---\n\n")}`
      : "",
    opts.extra ? `Дополнительно от автора: ${opts.extra}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await client(apiKey).chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: 900,
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}

/** Генерує зображення під пост. Повертає base64 PNG (data без префікса). */
export async function generateImage(
  apiKey: string,
  prompt: string,
): Promise<{ b64: string; mime: string }> {
  const res = await client(apiKey).images.generate({
    model: IMAGE_MODEL,
    prompt,
    size: "1024x1024",
    n: 1,
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-1 не вернул изображение");
  return { b64, mime: "image/png" };
}
