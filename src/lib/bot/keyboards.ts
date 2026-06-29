import { InlineKeyboard } from "grammy";
import { POST_TYPES, POST_TYPE_LABEL } from "../posts";

// Маркери у тексті prompt-повідомлень для force_reply (несуть контекст між
// одиничним повідомленням-відповіддю — serverless-friendly, без сесій).
export const MARK = {
  topic: (type: string) => `[#topic:${type}]`,
  own: (postId: string) => `[#own:${postId}]`,
  media: (postId: string) => `[#media:${postId}]`,
  channel: () => `[#channel]`,
  styleSamples: () => `[#style]`,
  ctaText: () => `[#ctatext]`,
  ctaUrl: () => `[#ctaurl]`,
  learnLink: () => `[#learnlink]`,
  banner: () => `[#banner]`,
  htag: (type: string) => `[#htag:${type}]`,
  emoji: () => `[#emoji]`,
  pemoji: () => `[#pemoji]`,
  phash: (postId: string) => `[#phash:${postId}]`,
};

/** Клавіатура налаштувань: CTA-кнопка (вкл/викл, текст, посилання). */
export function settingsKeyboard(ctaEnabled: boolean): InlineKeyboard {
  return new InlineKeyboard()
    .text(ctaEnabled ? "🔘 Кнопка: ВКЛ" : "⚪ Кнопка: ВЫКЛ", "cta:toggle")
    .row()
    .text("✏️ Текст кнопки", "cta:settext")
    .text("🔗 Ссылка кнопки", "cta:seturl");
}

export function parseMark(text?: string | null): { kind: string; arg?: string } | null {
  if (!text) return null;
  const m = text.match(/\[#(\w+)(?::([^\]]+))?\]/);
  if (!m) return null;
  return { kind: m[1], arg: m[2] };
}

/** Клавіатура вибору типу поста. */
export function postTypeKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  POST_TYPES.forEach((t, i) => {
    kb.text(POST_TYPE_LABEL[t], `type:${t}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

/** Клавіатура під чернеткою (апрув + медіа + регенерація + хештеги). */
export function previewKeyboard(postId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Опубликовать", `pub:${postId}`)
    .row()
    .text("🖼 Сгенерировать картинку", `gimg:${postId}`)
    .text("📎 Своё медиа", `umd:${postId}`)
    .row()
    .text("🏷 Хештеги", `phash:${postId}`)
    .text("🔄 Другой вариант", `regen:${postId}`)
    .row()
    .text("✏️ Свой текст", `own:${postId}`)
    .text("🗑 Удалить", `del:${postId}`);
}

/** Клавіатура під темою (згенерувати тему автоматично). */
export function topicKeyboard(type: string): InlineKeyboard {
  return new InlineKeyboard().text("🤖 Сгенерировать тему", `autotopic:${type}`);
}
