import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseJsonArray } from "@/lib/posts";
import { saveStyleManualAction, analyzeStyleAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function StylePage() {
  const admin = await requireAdmin();
  const sp = await prisma.styleProfile.findUnique({ where: { tenantId: admin.tenantId } });
  const refs = parseJsonArray<string>(sp?.referencesJson);
  let analysis: Record<string, unknown> | null = null;
  try {
    analysis = sp?.analysisJson ? JSON.parse(sp.analysisJson) : null;
  } catch {}

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">Стиль канала</h1>
      <p className="mb-6 text-sm text-white/50">
        Бот пишет посты в стиле канала. Источник: авто-анализ истории через скрипт
        <code className="mx-1">style:scrape</code> (GramJS) или ручные референсы ниже.
        Разделяй примеры пустой строкой или строкой из дефисов.
      </p>

      <form action={saveStyleManualAction} className="mb-6 flex flex-col gap-3">
        <label className="text-sm text-white/70">Тематика канала</label>
        <input
          name="topic"
          defaultValue={sp?.topic ?? ""}
          placeholder="напр. арбитраж трафика, кейсы по гемблингу/крипте"
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-400"
        />
        <label className="text-sm text-white/70">Референс-посты (примеры стиля)</label>
        <textarea
          name="references"
          defaultValue={refs.join("\n---\n")}
          rows={10}
          placeholder={"Пример поста 1...\n---\nПример поста 2..."}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-400"
        />
        <div className="flex gap-2">
          <button className="rounded-lg bg-sky-500 px-4 py-2 text-sm hover:bg-sky-400">
            Сохранить
          </button>
        </div>
      </form>

      <form action={analyzeStyleAction} className="mb-8">
        <button className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/10">
          🤖 Проанализировать стиль (Claude) — {sp?.samplesCount ?? 0} примеров
        </button>
      </form>

      {analysis && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="mb-3 text-lg font-semibold">Анализ стиля</h2>
          <dl className="grid gap-2 text-sm">
            {Object.entries(analysis).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[140px_1fr] gap-2">
                <dt className="text-white/50">{k}</dt>
                <dd className="text-white/85">
                  {Array.isArray(v) ? v.join(", ") : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
