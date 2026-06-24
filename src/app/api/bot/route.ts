import { webhookCallback } from "grammy";
import { getConfiguredBot } from "@/lib/bot/build";
import { env } from "@/lib/env";

// Telegram webhook. Бот ініціалізується ліниво у webhookCallback.
// Перевірка secret_token — через опцію secretToken (grammY звіряє заголовок
// X-Telegram-Bot-Api-Secret-Token).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ліниво створюємо handler при першому запиті — щоб білд (без токена) не падав.
let cachedHandler: ((req: Request) => Promise<Response>) | null = null;
function getHandler() {
  if (!cachedHandler) {
    cachedHandler = webhookCallback(getConfiguredBot(), "std/http", {
      secretToken: env.telegramWebhookSecret || undefined,
    });
  }
  return cachedHandler;
}

export async function POST(req: Request): Promise<Response> {
  try {
    return await getHandler()(req);
  } catch (e) {
    console.error("[bot webhook]", e);
    // 200 щоб Telegram не ретраїв нескінченно через помилку обробки
    return new Response("ok", { status: 200 });
  }
}

export async function GET(): Promise<Response> {
  return new Response("tg-poster bot webhook is up", { status: 200 });
}
