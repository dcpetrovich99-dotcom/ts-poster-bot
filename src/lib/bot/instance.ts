import "server-only";
import { Bot } from "grammy";
import { env } from "../env";

// Єдиний grammY Bot на інстанс. .api використовуємо і у вебхуку, і при
// публікації з крону/адмінки. Хендлери реєструються у bot/handlers.ts.

const globalForBot = globalThis as unknown as { bot?: Bot };

export function getBot(): Bot {
  if (!env.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN відсутній — бот недоступний");
  }
  if (!globalForBot.bot) {
    globalForBot.bot = new Bot(env.telegramBotToken);
  }
  return globalForBot.bot;
}
