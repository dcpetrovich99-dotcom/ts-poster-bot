import Link from "next/link";
import { getCurrentAdmin } from "@/lib/auth";
import { logoutAction } from "./actions";

const NAV = [
  { href: "/admin", label: "Дашборд" },
  { href: "/admin/posts", label: "Посты" },
  { href: "/admin/channels", label: "Каналы" },
  { href: "/admin/style", label: "Стиль" },
  { href: "/admin/links", label: "Ссылки" },
  { href: "/admin/keys", label: "Ключи и баланс" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  return (
    <div className="min-h-screen">
      {admin && (
        <header className="border-b border-white/10 bg-black/20">
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-5 py-3 text-sm">
            <span className="font-semibold text-sky-400">TG Poster</span>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-white/70 hover:text-white">
                {n.label}
              </Link>
            ))}
            {admin.role === "superadmin" && (
              <Link href="/admin/super" className="text-amber-300 hover:text-amber-200">
                Все доступы
              </Link>
            )}
            <form action={logoutAction} className="ml-auto">
              <button className="text-white/50 hover:text-white">Выйти ({admin.login})</button>
            </form>
          </nav>
        </header>
      )}
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
    </div>
  );
}
