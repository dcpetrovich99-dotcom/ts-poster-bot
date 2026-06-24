import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-6 px-6">
      <h1 className="text-4xl font-bold tracking-tight">TG Poster</h1>
      <p className="text-lg text-white/70">
        SaaS-бот автопостингу в Telegram: генерація в твоєму стилі, апрув і
        публікація з закріпленою кнопкою, хештегами та CTA.
      </p>
      <Link
        href="/admin"
        className="rounded-lg bg-sky-500 px-5 py-2.5 font-medium text-white transition hover:bg-sky-400"
      >
        Відкрити адмінку →
      </Link>
    </main>
  );
}
