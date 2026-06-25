import "server-only";
import { InputFile } from "grammy";
import { getBot } from "./instance";
import { prisma } from "../db";
import { getMedia } from "../media";
import { parseJsonArray } from "../posts";
import type { InlineButton } from "../telegram";

const CAPTION_LIMIT = 1024;

/** Будує фінальний текст: HTML-тіло + рядок хештегів. */
function buildText(bodyHtml: string, hashtags: string[]): string {
  const tags = hashtags.filter(Boolean).join(" ");
  return tags ? `${bodyHtml}\n\n${tags}` : bodyHtml;
}

/** Публікує пост у канал: текст/фото + синя CTA-кнопка + (опц.) закріплення. */
export async function publishPost(postId: string): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { channel: true },
  });
  if (!post) return { ok: false, error: "Пост не знайдено" };
  if (!post.channel) return { ok: false, error: "До поста не привʼязано канал" };

  // Кнопка додається ТІЛЬКИ якщо CTA увімкнена (buttonsJson заповнений при генерації).
  const buttons = parseJsonArray<InlineButton>(post.buttonsJson).filter((b) => b.label && b.url);
  const keyboard = buttons.length
    ? { inline_keyboard: buttons.map((b) => [{ text: b.label, url: b.url }]) }
    : undefined;

  const hashtags = parseJsonArray<string>(post.hashtagsJson);
  const text = buildText(post.bodyHtml, hashtags);
  const bot = getBot();
  const chatId = post.channel.chatId;

  try {
    let messageId: number;

    if (post.mediaType !== "none" && post.mediaRef) {
      const media = await getMedia(post.mediaRef);
      if (!media) return { ok: false, error: "Медіа не знайдено у сховищі" };
      const file = new InputFile(media.data);

      if (text.length <= CAPTION_LIMIT) {
        const msg =
          post.mediaType === "video"
            ? await bot.api.sendVideo(chatId, file, {
                caption: text,
                parse_mode: "HTML",
                reply_markup: keyboard,
              })
            : await bot.api.sendPhoto(chatId, file, {
                caption: text,
                parse_mode: "HTML",
                reply_markup: keyboard,
              });
        messageId = msg.message_id;
      } else {
        // Підпис задовгий для медіа: спершу медіа без підпису, далі текст із кнопкою.
        if (post.mediaType === "video") {
          await bot.api.sendVideo(chatId, file);
        } else {
          await bot.api.sendPhoto(chatId, file);
        }
        const msg = await bot.api.sendMessage(chatId, text, {
          parse_mode: "HTML",
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        });
        messageId = msg.message_id;
      }
    } else {
      const msg = await bot.api.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
      messageId = msg.message_id;
    }

    // Закріплення — щоб синя кнопка лишалась видимою вгорі каналу.
    if (post.pinOnPublish && post.channel.canPin) {
      try {
        await bot.api.pinChatMessage(chatId, messageId, { disable_notification: true });
      } catch {
        /* не критично, якщо немає прав на закріплення */
      }
    }

    await prisma.post.update({
      where: { id: post.id },
      data: { status: "published", tgMessageId: messageId, publishedAt: new Date(), errorText: null },
    });
    return { ok: true, messageId };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.post.update({
      where: { id: post.id },
      data: { status: "failed", errorText: error },
    });
    return { ok: false, error };
  }
}
