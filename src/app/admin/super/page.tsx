import Link from "next/link";
import { requireSuperadmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { detachChannelAction } from "../actions";

export const dynamic = "force-dynamic";

// Глобальний огляд для власника сервісу: усі tenants, їхні канали (прив'язки до
// моменту відвʼязки), адміни та MTProto-статус. Дані інших tenant'ів видно ТІЛЬКИ тут.
export default async function SuperPage() {
  await requireSuperadmin();
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      channels: { orderBy: { connectedAt: "asc" } },
      adminUsers: true,
      userSessions: true,
      _count: { select: { posts: true } },
    },
  });

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">Все доступы (superadmin)</h1>
      <p className="mb-6 text-sm text-white/50">
        Все рабочие пространства и привязанные каналы. Канал исчезает отсюда, как
        только клиент его отвязал. Данные одного клиента не видны другим — только
        тебе на этой странице.
      </p>

      <div className="flex flex-col gap-4">
        {tenants.map((t) => (
          <div key={t.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{t.name}</span>
              <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/60">
                tg-владелец: {t.ownerTgId ?? "—"}
              </span>
              <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/60">
                {t.status}
              </span>
              <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/60">
                постов: {t._count.posts}
              </span>
              <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/60">
                MTProto: {t.userSessions.length ? "есть" : "нет"}
              </span>
            </div>
            <div className="mb-2 text-xs text-white/40">
              админы: {t.adminUsers.map((a) => `${a.login}(${a.role})`).join(", ") || "—"}
            </div>

            {t.channels.length === 0 ? (
              <div className="text-sm text-white/40">нет привязанных каналов</div>
            ) : (
              <div className="flex flex-col gap-2">
                {t.channels.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                  >
                    <span className="font-medium">
                      {c.title ?? c.username ?? c.chatId}
                      {c.isDefault && <span className="ml-1 text-xs text-sky-300">(основной)</span>}
                    </span>
                    <span className="text-xs text-white/40">
                      id {c.chatId} · publish {c.canPost ? "✓" : "✗"} · pin {c.canPin ? "✓" : "✗"}
                    </span>
                    <div className="ml-auto flex gap-2">
                      <Link
                        href={`/api/admin/subscribers/${c.id}`}
                        prefetch={false}
                        className="rounded border border-white/15 px-2 py-1 text-xs hover:bg-white/10"
                      >
                        📥 Excel
                      </Link>
                      <form action={detachChannelAction}>
                        <input type="hidden" name="channelId" value={c.id} />
                        <button className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10">
                          🔌 Отвязать
                        </button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
