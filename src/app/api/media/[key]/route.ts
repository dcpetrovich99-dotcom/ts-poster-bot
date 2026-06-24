import { getMedia } from "@/lib/media";
import { getCurrentAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Віддача медіа (для прев'ю в адмінці). Лише для автентифікованого адміна.
export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) return new Response("unauthorized", { status: 401 });
  const { key } = await ctx.params;
  const media = await getMedia(key);
  if (!media) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(media.data), {
    headers: { "content-type": media.mime, "cache-control": "private, max-age=300" },
  });
}
