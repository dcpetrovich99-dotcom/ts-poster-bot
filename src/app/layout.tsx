import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TG Poster — автопостинг у Telegram",
  description: "SaaS-бот: генерація, апрув і публікація постів у Telegram-каналах.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
