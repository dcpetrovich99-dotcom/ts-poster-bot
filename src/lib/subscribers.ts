import "server-only";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { prisma } from "./db";
import { env } from "./env";
import { decryptSecret } from "./crypto";

// Експорт підписників каналу. ВАЖЛИВО: Bot API НЕ дозволяє перелічити підписників
// каналу — лише MTProto (user-сесія власника). Тому потрібна збережена
// TgUserSession (логін через `npm run style:scrape`). KYC/безпекова вигрузка.

export type Subscriber = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  phone: string;
  isBot: boolean;
  isDeleted: boolean;
};

export async function fetchChannelSubscribers(
  tenantId: string,
  channelId: string,
  limit = 5000,
): Promise<{ ok: true; channelTitle: string; subscribers: Subscriber[] } | { ok: false; error: string }> {
  if (!env.telegramApiId || !env.telegramApiHash) {
    return { ok: false, error: "Не заданы TELEGRAM_API_ID / TELEGRAM_API_HASH" };
  }
  const channel = await prisma.tgChannel.findFirst({ where: { id: channelId, tenantId } });
  if (!channel) return { ok: false, error: "Канал не найден или нет доступа" };

  const sess = await prisma.tgUserSession.findUnique({ where: { tenantId } });
  if (!sess) {
    return {
      ok: false,
      error: "Нет MTProto-сессии. Сначала выполни `npm run style:scrape` для входа под своим аккаунтом.",
    };
  }

  let sessionStr = "";
  try {
    sessionStr = decryptSecret(sess.sessionEncrypted);
  } catch {
    return { ok: false, error: "Повреждённая MTProto-сессия" };
  }

  const client = new TelegramClient(new StringSession(sessionStr), env.telegramApiId, env.telegramApiHash, {
    connectionRetries: 3,
  });

  try {
    await client.connect();
    const entity = channel.username ? `@${channel.username}` : Number(channel.chatId);
    const participants = await client.getParticipants(entity, { limit });
    const subscribers: Subscriber[] = participants.map((u) => {
      const user = u as {
        id?: { toString(): string };
        username?: string;
        firstName?: string;
        lastName?: string;
        phone?: string;
        bot?: boolean;
        deleted?: boolean;
      };
      return {
        id: user.id ? user.id.toString() : "",
        username: user.username ?? "",
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        phone: user.phone ?? "",
        isBot: !!user.bot,
        isDeleted: !!user.deleted,
      };
    });
    await client.disconnect();
    return { ok: true, channelTitle: channel.title ?? channel.username ?? channel.chatId, subscribers };
  } catch (e) {
    try {
      await client.disconnect();
    } catch {}
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
