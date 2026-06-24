import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { POST_TYPE_LABEL, parseJsonArray } from "@/lib/posts";
import { publishAction, deletePostAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "черновик",
  awaiting_approval: "на апрув",
  scheduled: "запланирован",
  published: "опубликован",
  failed: "ошибка",
};

export default async function PostsPage() {
  const admin = await requireAdmin();
  const posts = await prisma.post.findMany({
    where: { tenantId: admin.tenantId },
    include: { channel: true },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Посты</h1>
      {posts.length === 0 && (
        <p className="text-white/50">Постов пока нет. Создай через бота: /new</p>
      )}
      <div className="flex flex-col gap-4">
        {posts.map((p) => {
          const tags = parseJsonArray<string>(p.hashtagsJson).join(" ");
          const canAct = p.status === "awaiting_approval" || p.status === "draft" || p.status === "failed";
          return (
            <div key={p.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-sky-500/20 px-2 py-0.5 text-sky-300">
                  {POST_TYPE_LABEL[p.type]}
                </span>
                <span className="rounded bg-white/10 px-2 py-0.5 text-white/70">
                  {STATUS_LABEL[p.status] ?? p.status}
                </span>
                {p.mediaType !== "none" && (
                  <span className="rounded bg-white/10 px-2 py-0.5 text-white/70">🖼 {p.mediaType}</span>
                )}
                {p.channel && (
                  <span className="text-white/50">
                    → {p.channel.title ?? p.channel.username ?? p.channel.chatId}
                  </span>
                )}
              </div>
              <div
                className="whitespace-pre-wrap text-sm text-white/85"
                dangerouslySetInnerHTML={{ __html: p.bodyHtml }}
              />
              {tags && <div className="mt-2 text-xs text-sky-300">{tags}</div>}
              {p.errorText && <div className="mt-2 text-xs text-red-400">⚠️ {p.errorText}</div>}
              {canAct && (
                <div className="mt-3 flex gap-2">
                  <form action={publishAction}>
                    <input type="hidden" name="postId" value={p.id} />
                    <button className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm hover:bg-sky-400">
                      ✅ Опубликовать
                    </button>
                  </form>
                  <form action={deletePostAction}>
                    <input type="hidden" name="postId" value={p.id} />
                    <button className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10">
                      🗑 Удалить
                    </button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
