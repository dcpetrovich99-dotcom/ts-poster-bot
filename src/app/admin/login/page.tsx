import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/auth";
import { loginAction } from "../actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const admin = await getCurrentAdmin();
  if (admin) redirect("/admin");
  const { error } = await searchParams;

  return (
    <div className="mx-auto mt-20 max-w-sm">
      <h1 className="mb-6 text-2xl font-bold">Вход в админку</h1>
      <form action={loginAction} className="flex flex-col gap-3">
        <input
          name="login"
          placeholder="Логин"
          autoComplete="username"
          className="rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 outline-none focus:border-sky-400"
        />
        <input
          name="password"
          type="password"
          placeholder="Пароль"
          autoComplete="current-password"
          className="rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 outline-none focus:border-sky-400"
        />
        {error && <p className="text-sm text-red-400">Неверный логин или пароль</p>}
        <button className="rounded-lg bg-sky-500 px-4 py-2.5 font-medium hover:bg-sky-400">
          Войти
        </button>
      </form>
    </div>
  );
}
