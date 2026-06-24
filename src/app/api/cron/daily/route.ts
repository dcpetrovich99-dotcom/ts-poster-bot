import { runDailyReminders } from "@/lib/cron";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  if (!env.cronSecret) return !env.isProd; // локально дозволяємо без секрету
  const url = new URL(req.url);
  const headerSecret = req.headers.get("x-cron-secret");
  const querySecret = url.searchParams.get("secret");
  return headerSecret === env.cronSecret || querySecret === env.cronSecret;
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const res = await runDailyReminders();
  return new Response(JSON.stringify({ ok: true, ...res }), {
    headers: { "content-type": "application/json" },
  });
}

export const POST = handle;
export const GET = handle;
