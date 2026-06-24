import "server-only";
import { env } from "./env";

// Тонкий клієнт Telegram Bot API через fetch — для роутів, крону і скриптів
// (там, де не потрібен повний grammY-контекст). grammY використовуємо у вебхуку.

const API = "https://api.telegram.org";

export type TgResult<T> = { ok: true; result: T } | { ok: false; error: string };

export async function tgApi<T = unknown>(
  method: string,
  params: Record<string, unknown>,
  token = env.telegramBotToken,
): Promise<TgResult<T>> {
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN відсутній" };
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = (await res.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
    };
    if (!data.ok) return { ok: false, error: data.description ?? `HTTP ${res.status}` };
    return { ok: true, result: data.result as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** "@nick" | "nick" | "https://t.me/nick" → "nick". */
export function tgUsername(raw: string): string {
  let s = (raw || "").trim();
  s = s.replace(/^https?:\/\/t\.me\//i, "");
  s = s.replace(/^@/, "");
  s = s.split(/[/?#]/)[0];
  return s;
}

export type InlineButton = { label: string; url: string };

/** Будує inline_keyboard з url-кнопок (по одній у рядок) — це «сині кнопки». */
export function inlineKeyboard(buttons: InlineButton[]) {
  if (!buttons.length) return undefined;
  return {
    inline_keyboard: buttons
      .filter((b) => b.label && b.url)
      .map((b) => [{ text: b.label, url: b.url }]),
  };
}

export type ChatInfo = {
  id: number;
  type: string;
  title?: string;
  username?: string;
};

export function getChat(chatId: string | number, token?: string) {
  return tgApi<ChatInfo>("getChat", { chat_id: chatId }, token);
}

export type ChatMember = {
  status: string;
  can_post_messages?: boolean;
  can_pin_messages?: boolean;
};

export function getChatMember(
  chatId: string | number,
  userId: string | number,
  token?: string,
) {
  return tgApi<ChatMember>("getChatMember", { chat_id: chatId, user_id: userId }, token);
}
