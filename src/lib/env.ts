// Централізований доступ до env. Жодних секретів у коді — лише читання.

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  appHost: process.env.APP_HOST ?? "localhost:3000",
  allowedHosts: (process.env.APP_ALLOWED_HOSTS ?? "localhost:3000,127.0.0.1:3000")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),

  encryptionKey: process.env.APP_ENCRYPTION_KEY ?? "",
  authSecret: process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me",

  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
  telegramApiId: Number(process.env.TELEGRAM_API_ID ?? "0"),
  telegramApiHash: process.env.TELEGRAM_API_HASH ?? "",

  openaiKey: process.env.OPENAI_API_KEY ?? "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",

  cronSecret: process.env.CRON_SECRET ?? "",
  ownerTgId: process.env.OWNER_TG_ID ?? "",

  isProd: process.env.NODE_ENV === "production",
};

/** Базовий URL застосунку (https на проді, http локально). */
export function appBaseUrl(): string {
  const proto = env.isProd ? "https" : "http";
  return `${proto}://${env.appHost}`;
}
