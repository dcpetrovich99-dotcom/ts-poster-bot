export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Healthcheck для Railway (railway.json → healthcheckPath).
export function GET() {
  return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
    headers: { "content-type": "application/json" },
  });
}
