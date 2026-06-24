import "server-only";
import { getBot } from "./instance";
import { registerHandlers } from "./handlers";

const globalForBuild = globalThis as unknown as { botConfigured?: boolean };

/** Повертає налаштований бот (хендлери зареєстровані один раз). */
export function getConfiguredBot() {
  const bot = getBot();
  if (!globalForBuild.botConfigured) {
    registerHandlers(bot);
    globalForBuild.botConfigured = true;
  }
  return bot;
}
