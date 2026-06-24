import "server-only";
import { InlineKeyboard } from "grammy";
import { prisma } from "./db";
import { getBot } from "./bot/instance";
import { POST_TYPE_LABEL } from "./posts";

// Щоденні нагадування: для кожного tenant з підключеним каналом і власником
// бот шле тему на сьогодні (з контент-плану) з кнопками генерації/пропуску.

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function runDailyReminders(): Promise<{ sent: number; skipped: number }> {
  const bot = getBot();
  const tenants = await prisma.tenant.findMany({
    where: { status: "active", ownerTgId: { not: null }, channels: { some: {} } },
  });

  let sent = 0;
  let skipped = 0;
  const { start, end } = todayRange();

  for (const t of tenants) {
    if (!t.ownerTgId) continue;

    const item =
      (await prisma.contentPlanItem.findFirst({
        where: { tenantId: t.id, date: { gte: start, lt: end }, status: { in: ["suggested", "accepted"] } },
        orderBy: { date: "asc" },
      })) ??
      (await prisma.contentPlanItem.findFirst({
        where: { tenantId: t.id, status: "suggested" },
        orderBy: { date: "asc" },
      }));

    try {
      if (item) {
        const kb = new InlineKeyboard()
          .text("✅ Сгенерировать", `plangen:${item.id}`)
          .text("⏭ Пропустить", `planskip:${item.id}`)
          .row()
          .text("📝 Другой пост", "newpost");
        await bot.api.sendMessage(
          t.ownerTgId,
          `🗓 <b>Тема на сегодня</b>\n${POST_TYPE_LABEL[item.type]} — ${item.topic}`,
          { parse_mode: "HTML", reply_markup: kb },
        );
      } else {
        const kb = new InlineKeyboard().text("📝 Создать пост", "newpost");
        await bot.api.sendMessage(
          t.ownerTgId,
          "🗓 Пора опубликовать пост. Контент-план пуст — нажми, чтобы создать (или /plan для генерации плана).",
          { reply_markup: kb },
        );
      }
      sent++;
    } catch {
      skipped++;
    }
  }
  return { sent, skipped };
}
