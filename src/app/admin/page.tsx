import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tenantBalance } from "@/lib/ai/keys";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const admin = await requireAdmin();
  const t = admin.tenantId;
  const [channels, awaiting, published, balance, style, plan] = await Promise.all([
    prisma.tgChannel.count({ where: { tenantId: t } }),
    prisma.post.count({ where: { tenantId: t, status: "awaiting_approval" } }),
    prisma.post.count({ where: { tenantId: t, status: "published" } }),
    tenantBalance(t),
    prisma.styleProfile.findUnique({ where: { tenantId: t } }),
    prisma.contentPlanItem.count({ where: { tenantId: t, status: "suggested" } }),
  ]);

  const cards = [
    { label: "Каналы", value: channels, href: "/admin/channels" },
    { label: "Черновики на апрув", value: awaiting, href: "/admin/posts" },
    { label: "Опубликовано", value: published, href: "/admin/posts" },
    { label: "Баланс (кредиты)", value: balance, href: "/admin/keys" },
    { label: "План: тем в очереди", value: plan, href: "/admin/style" },
    {
      label: "Стиль канала",
      value: style?.analysisJson ? "готов" : "не задан",
      href: "/admin/style",
    },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Дашборд</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-xl border border-white/10 bg-white/5 p-5 transition hover:border-sky-400/50"
          >
            <div className="text-3xl font-bold">{c.value}</div>
            <div className="mt-1 text-sm text-white/60">{c.label}</div>
          </Link>
        ))}
      </div>
      <p className="mt-8 text-sm text-white/50">
        Создание постов и публикация — через Telegram-бота (/new). Здесь — настройки,
        апрув черновиков, стиль, ссылки и ключи.
      </p>
    </div>
  );
}
