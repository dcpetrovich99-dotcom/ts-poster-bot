import "dotenv/config";

// Встановлює Telegram webhook на <APP_HOST>/api/bot із secret_token.
// Запуск: npm run bot:set-webhook  (APP_HOST=прод-домен або ngrok/cloudflared)

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const host = process.env.APP_HOST;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (!token || !host) {
    throw new Error("Потрібні TELEGRAM_BOT_TOKEN і APP_HOST у .env");
  }
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const url = `${proto}://${host}/api/bot`;

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secret || undefined,
      allowed_updates: ["message", "callback_query", "channel_post"],
      drop_pending_updates: true,
    }),
  });
  const data = await res.json();
  console.log("setWebhook →", JSON.stringify(data));
  console.log("Webhook URL:", url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
