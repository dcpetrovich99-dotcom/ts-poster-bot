import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setDefaultChannelAction, detachChannelAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const admin = await requireAdmin();
  const channels = await prisma.tgChannel.findMany({
    where: { tenantId: admin.tenantId },
    orderBy: { connectedAt: "asc" },
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Каналы</h1>
      {channels.length === 0 ? (
        <p className="text-white/50">
          Каналов нет. Подключи через бота: добавь бота в админы канала и пришли боту
          /connect, затем перешли пост из канала или его @username.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {channels.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4"
            >
              <div>
                <div className="font-medium">
                  {c.title ?? c.username ?? c.chatId}
                  {c.isDefault && (
                    <span className="ml-2 rounded bg-sky-500/20 px-2 py-0.5 text-xs text-sky-300">
                      по умолчанию
                    </span>
                  )}
                </div>
                <div className="text-xs text-white/50">
                  {c.username ? `@${c.username} · ` : ""}публикация: {c.canPost ? "да" : "нет"} ·
                  закрепление: {c.canPin ? "да" : "нет"}
                </div>
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                {!c.isDefault && (
                  <form action={setDefaultChannelAction}>
                    <input type="hidden" name="channelId" value={c.id} />
                    <button className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10">
                      Сделать основным
                    </button>
                  </form>
                )}
                <Link
                  href={`/api/admin/subscribers/${c.id}`}
                  prefetch={false}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10"
                >
                  📥 Подписчики (Excel)
                </Link>
                <form action={detachChannelAction}>
                  <input type="hidden" name="channelId" value={c.id} />
                  <button className="rounded-lg border border-red-500/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10">
                    🔌 Отвязать
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
