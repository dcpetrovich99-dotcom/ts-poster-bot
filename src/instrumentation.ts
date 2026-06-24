// In-process планувальник щоденних нагадувань (Railway = always-on Node-процес).
// Запускається один раз при старті сервера. На serverless (Netlify) не виконається —
// там лишається Netlify Scheduled Function або зовнішній cron на /api/cron/daily.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.TELEGRAM_BOT_TOKEN) return;

  const g = globalThis as unknown as { __cronStarted?: boolean };
  if (g.__cronStarted) return;
  g.__cronStarted = true;

  const hour = Number(process.env.CRON_HOUR ?? "8"); // година (UTC на Railway)

  function msUntilNext(): number {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(hour, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
  }

  async function run() {
    try {
      const { runDailyReminders } = await import("@/lib/cron");
      const res = await runDailyReminders();
      console.log(`[cron] daily reminders: sent=${res.sent} skipped=${res.skipped}`);
    } catch (e) {
      console.error("[cron] error", e);
    }
  }

  setTimeout(() => {
    run();
    setInterval(run, 24 * 60 * 60 * 1000);
  }, msUntilNext());

  console.log(`[cron] scheduled daily reminders at ${hour}:00 UTC`);
}
