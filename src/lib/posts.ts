import type { PostType } from "@/generated/prisma/client";

// Людські назви типів постів (для кнопок/адмінки) + дефолтні хештеги
// (рос. термінологія каналу: #отзыв/#кейс/#новость/#апдейт тощо).

export const POST_TYPE_LABEL: Record<PostType, string> = {
  news: "Новость",
  case: "Кейс",
  review: "Отзыв",
  about: "О нас",
  update: "Апдейт (новый источник)",
  blog: "Блог / опыт",
  fun: "Интересное",
  info: "Инфо",
};

export const POST_TYPE_HASHTAGS: Record<PostType, string[]> = {
  news: ["#новость"],
  case: ["#кейс"],
  review: ["#отзыв"],
  about: ["#онас"],
  update: ["#апдейт"],
  blog: ["#блог"],
  fun: ["#интересное"],
  info: ["#инфо"],
};

export const POST_TYPES: PostType[] = [
  "news",
  "case",
  "review",
  "about",
  "update",
  "blog",
  "fun",
  "info",
];

export function parseJsonArray<T = unknown>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}
