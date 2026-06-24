import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveLinkAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function LinksPage() {
  const admin = await requireAdmin();
  const links = await prisma.linkSetting.findMany({
    where: { tenantId: admin.tenantId },
    orderBy: { key: "asc" },
  });

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">Приватные ссылки</h1>
      <p className="mb-6 text-sm text-white/50">
        Ссылка <code>contact_us</code> — это CTA «написать нам»: она вставляется и в
        текст поста (гиперссылкой), и в синюю кнопку под постом.
      </p>

      <div className="flex flex-col gap-4">
        {links.map((l) => (
          <form
            key={l.id}
            action={saveLinkAction}
            className="grid grid-cols-1 gap-2 rounded-xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[120px_1fr_2fr_auto] sm:items-center"
          >
            <input type="hidden" name="key" value={l.key} />
            <div className="text-sm text-white/60">{l.key}</div>
            <input
              name="label"
              defaultValue={l.label}
              placeholder="Текст кнопки"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-400"
            />
            <input
              name="url"
              defaultValue={l.url}
              placeholder="https://t.me/..."
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-400"
            />
            <button className="rounded-lg bg-sky-500 px-3 py-2 text-sm hover:bg-sky-400">
              Сохранить
            </button>
          </form>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Добавить ссылку</h2>
      <form
        action={saveLinkAction}
        className="grid grid-cols-1 gap-2 rounded-xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[120px_1fr_2fr_auto] sm:items-center"
      >
        <input
          name="key"
          placeholder="ключ (manager)"
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-400"
        />
        <input
          name="label"
          placeholder="Текст"
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-400"
        />
        <input
          name="url"
          placeholder="https://t.me/..."
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-400"
        />
        <button className="rounded-lg bg-sky-500 px-3 py-2 text-sm hover:bg-sky-400">
          Добавить
        </button>
      </form>
    </div>
  );
}
