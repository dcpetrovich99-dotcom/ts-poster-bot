import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tenantBalance } from "@/lib/ai/keys";
import { saveKeyAction, topupAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const admin = await requireAdmin();
  const [creds, balance, ledger] = await Promise.all([
    prisma.apiCredential.findMany({ where: { tenantId: admin.tenantId } }),
    tenantBalance(admin.tenantId),
    prisma.balanceEntry.findMany({
      where: { tenantId: admin.tenantId },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);
  const has = (p: string) => creds.some((c) => c.provider === p && c.isActive);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Ключи и баланс</h1>

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        {(["openai", "anthropic"] as const).map((p) => (
          <form
            key={p}
            action={saveKeyAction}
            className="rounded-xl border border-white/10 bg-white/5 p-4"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium capitalize">{p}</span>
              <span className={`text-xs ${has(p) ? "text-green-400" : "text-white/40"}`}>
                {has(p) ? "ключ задан" : "не задан"}
              </span>
            </div>
            <input type="hidden" name="provider" value={p} />
            <input
              name="key"
              type="password"
              placeholder={`${p} API key`}
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-400"
            />
            <button className="mt-2 rounded-lg bg-sky-500 px-3 py-2 text-sm hover:bg-sky-400">
              Сохранить ключ
            </button>
          </form>
        ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">
            Баланс: <span className="text-sky-400">{balance}</span> кредитов
          </div>
          <form action={topupAction} className="flex gap-2">
            <input
              name="amount"
              type="number"
              min={1}
              placeholder="кредиты"
              className="w-28 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm outline-none focus:border-sky-400"
            />
            <button className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm hover:bg-sky-400">
              Пополнить
            </button>
          </form>
        </div>
        <ul className="text-sm text-white/60">
          {ledger.map((e) => (
            <li key={e.id} className="flex justify-between border-t border-white/5 py-1">
              <span>{e.reason}</span>
              <span className={e.amount >= 0 ? "text-green-400" : "text-white/70"}>
                {e.amount >= 0 ? "+" : ""}
                {e.amount}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
