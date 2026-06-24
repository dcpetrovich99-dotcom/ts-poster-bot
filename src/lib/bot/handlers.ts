import "server-only";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { prisma } from "../db";
import { env } from "../env";
import { getOrCreateTenantByTgId, getDefaultChannel } from "../tenant";
import { resolveApiKey } from "../ai/keys";
import { generateContentPlan } from "../ai/anthropic";
import {
  createDraft,
  regenerateDraft,
  setOwnText,
  attachGeneratedImage,
} from "../generate";
import { putMedia } from "../media";
import { publishPost } from "./publish";
import { parseJsonArray, POST_TYPE_LABEL } from "../posts";
import {
  postTypeKeyboard,
  previewKeyboard,
  topicKeyboard,
  MARK,
  parseMark,
} from "./keyboards";
import type { PostType } from "@/generated/prisma/client";

// ─── helpers ────────────────────────────────────────────────────────

async function tenantFor(ctx: Context) {
  const id = ctx.from?.id;
  if (!id) return null;
  const name = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ");
  return getOrCreateTenantByTgId(id, name || ctx.from?.username);
}

// ── ізоляція: усі callback-дії перевіряють, що обʼєкт належить tenant'у того,
// хто натиснув. Без цього юзер міг би підставити чужий id (cross-tenant leak).
async function ownedPost(ctx: Context, postId: string) {
  const tenant = await tenantFor(ctx);
  if (!tenant) return null;
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.tenantId !== tenant.id) return null;
  return post;
}

async function ownedPlanItem(ctx: Context, itemId: string) {
  const tenant = await tenantFor(ctx);
  if (!tenant) return null;
  const item = await prisma.contentPlanItem.findUnique({ where: { id: itemId } });
  if (!item || item.tenantId !== tenant.id) return null;
  return item;
}

async function ownedChannel(ctx: Context, channelId: string) {
  const tenant = await tenantFor(ctx);
  if (!tenant) return null;
  const ch = await prisma.tgChannel.findUnique({ where: { id: channelId } });
  if (!ch || ch.tenantId !== tenant.id) return null;
  return ch;
}

/** Прев'ю чернетки у чаті власника з кнопками апруву. */
async function sendPreview(ctx: Context, postId: string) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { channel: true },
  });
  if (!post) return;
  const hashtags = parseJsonArray<string>(post.hashtagsJson).join(" ");
  const media =
    post.mediaType !== "none" ? `\n\n🖼 <i>Медиа прикреплено (${post.mediaType})</i>` : "";
  const channel = post.channel
    ? `📡 Канал: ${post.channel.title ?? post.channel.username ?? post.channel.chatId}`
    : "⚠️ Канал не подключён — /connect";
  const head = `📝 <b>Черновик</b> · ${POST_TYPE_LABEL[post.type]}\n${channel}\n${"─".repeat(12)}\n\n`;
  const body = `${head}${post.bodyHtml}${hashtags ? `\n\n${hashtags}` : ""}${media}`;
  await ctx.reply(body.slice(0, 4096), {
    parse_mode: "HTML",
    reply_markup: previewKeyboard(postId),
    link_preview_options: { is_disabled: true },
  });
}

async function startDraftFor(ctx: Context, type: PostType, topic: string) {
  const tenant = await tenantFor(ctx);
  if (!tenant) return;
  await ctx.reply("⏳ Генерирую черновик…");
  const res = await createDraft({ tenantId: tenant.id, type, topic });
  if ("error" in res) {
    await ctx.reply(`❌ ${res.error}`);
    return;
  }
  await sendPreview(ctx, res.id);
}

// ─── реєстрація хендлерів ───────────────────────────────────────────

export function registerHandlers(bot: Bot) {
  bot.command("start", async (ctx) => {
    const tenant = await tenantFor(ctx);
    if (!tenant) return;
    const channel = await getDefaultChannel(tenant.id);
    await ctx.reply(
      [
        "👋 <b>TG Poster</b> — твой ассистент по ведению канала.",
        "",
        channel
          ? `✅ Канал подключён: <b>${channel.title ?? channel.username ?? channel.chatId}</b>`
          : "Канал ещё не подключён.",
        "",
        "Команды:",
        "• /connect — подключить канал",
        "• /channels — мои каналы / отвязать",
        "• /new — создать пост",
        "• /plan — контент-план на неделю",
        "• /help — помощь",
      ].join("\n"),
      { parse_mode: "HTML" },
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "ℹ️ Как подключить канал:",
        "1) Добавь этого бота в админы канала (право публиковать и закреплять).",
        "2) Перешли сюда любой пост из канала ИЛИ пришли @username канала.",
        "",
        "Создание поста: /new → выбери тип → дай тему (или сгенерируй) →",
        "получишь черновик → можешь добавить картинку/своё медиа →",
        "публикация только после кнопки «✅ Опубликовать».",
        "",
        "Настройки (ссылка «написать нам», API-ключи, стиль) — в веб-админке.",
      ].join("\n"),
    );
  });

  bot.command("connect", async (ctx) => {
    await ctx.reply(
      "📡 Подключение канала:\n" +
        "1) Добавь бота в админы канала (публикация + закрепление).\n" +
        "2) Перешли сюда любой пост из канала или пришли @username канала.",
    );
  });

  bot.command("new", async (ctx) => {
    const tenant = await tenantFor(ctx);
    if (!tenant) return;
    const channel = await getDefaultChannel(tenant.id);
    if (!channel) {
      await ctx.reply("⚠️ Сначала подключи канал: /connect");
      return;
    }
    await ctx.reply("Выбери тип поста:", { reply_markup: postTypeKeyboard() });
  });

  bot.command("channels", async (ctx) => {
    const tenant = await tenantFor(ctx);
    if (!tenant) return;
    const channels = await prisma.tgChannel.findMany({ where: { tenantId: tenant.id } });
    if (!channels.length) {
      await ctx.reply("У тебя нет подключённых каналов. /connect");
      return;
    }
    for (const c of channels) {
      const kb = new InlineKeyboard().text("🔌 Отвязать", `chdetach:${c.id}`);
      await ctx.reply(
        `📡 <b>${c.title ?? c.username ?? c.chatId}</b>\n` +
          `${c.isDefault ? "по умолчанию · " : ""}публикация: ${c.canPost ? "да" : "нет"} · закрепление: ${c.canPin ? "да" : "нет"}`,
        { parse_mode: "HTML", reply_markup: kb },
      );
    }
  });

  bot.command("plan", async (ctx) => {
    const tenant = await tenantFor(ctx);
    if (!tenant) return;
    const key = await resolveApiKey(tenant.id, "anthropic");
    if (!key) {
      await ctx.reply("❌ Нет Anthropic API-ключа (веб-админка → ключи).");
      return;
    }
    await ctx.reply("⏳ Составляю контент-план…");
    const sp = await prisma.styleProfile.findUnique({ where: { tenantId: tenant.id } });
    let style = null;
    try {
      style = sp?.analysisJson ? JSON.parse(sp.analysisJson) : null;
    } catch {}
    try {
      const plan = await generateContentPlan(key, { style, topic: sp?.topic ?? undefined, days: 7 });
      const now = new Date();
      await prisma.contentPlanItem.deleteMany({
        where: { tenantId: tenant.id, status: "suggested" },
      });
      for (const it of plan) {
        const date = new Date(now);
        date.setDate(date.getDate() + (it.dayOffset ?? 0));
        await prisma.contentPlanItem.create({
          data: { tenantId: tenant.id, date, topic: it.topic, type: it.type, status: "suggested" },
        });
      }
      const text = plan
        .map((it) => `• День +${it.dayOffset}: <b>${POST_TYPE_LABEL[it.type] ?? it.type}</b> — ${it.topic}`)
        .join("\n");
      await ctx.reply(`🗓 <b>Контент-план на неделю</b>\n\n${text}`, { parse_mode: "HTML" });
    } catch (e) {
      await ctx.reply(`❌ Не удалось: ${e instanceof Error ? e.message : e}`);
    }
  });

  bot.callbackQuery("newpost", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Выбери тип поста:", { reply_markup: postTypeKeyboard() });
  });

  // ── вибір типу → запит теми ──
  bot.callbackQuery(/^type:(.+)$/, async (ctx) => {
    const type = ctx.match![1] as PostType;
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `Тема для поста «${POST_TYPE_LABEL[type]}»? Ответь на это сообщение темой, или нажми кнопку. ${MARK.topic(type)}`,
      { reply_markup: topicKeyboard(type) },
    );
  });

  // ── автогенерація теми ──
  bot.callbackQuery(/^autotopic:(.+)$/, async (ctx) => {
    const type = ctx.match![1] as PostType;
    await ctx.answerCallbackQuery();
    const tenant = await tenantFor(ctx);
    if (!tenant) return;
    const key = await resolveApiKey(tenant.id, "anthropic");
    if (!key) {
      await ctx.reply("❌ Нет Anthropic API-ключа.");
      return;
    }
    const sp = await prisma.styleProfile.findUnique({ where: { tenantId: tenant.id } });
    let style = null;
    try {
      style = sp?.analysisJson ? JSON.parse(sp.analysisJson) : null;
    } catch {}
    let topic = "актуальная тема по нашей нише";
    try {
      const plan = await generateContentPlan(key, { style, topic: sp?.topic ?? undefined, days: 1 });
      if (plan[0]?.topic) topic = plan[0].topic;
    } catch {}
    await startDraftFor(ctx, type, topic);
  });

  // ── нагадування з контент-плану ──
  bot.callbackQuery(/^plangen:(.+)$/, async (ctx) => {
    const itemId = ctx.match![1];
    await ctx.answerCallbackQuery();
    const item = await ownedPlanItem(ctx, itemId);
    if (!item) {
      await ctx.reply("⚠️ Нет доступа к этому пункту плана.");
      return;
    }
    await prisma.contentPlanItem.update({ where: { id: itemId }, data: { status: "done" } });
    await startDraftFor(ctx, item.type, item.topic);
  });

  bot.callbackQuery(/^planskip:(.+)$/, async (ctx) => {
    const itemId = ctx.match![1];
    await ctx.answerCallbackQuery({ text: "Пропущено" });
    const item = await ownedPlanItem(ctx, itemId);
    if (!item) return;
    await prisma.contentPlanItem.update({ where: { id: itemId }, data: { status: "skipped" } });
    await ctx.reply("⏭ Пропустили. Можешь создать пост вручную: /new");
  });

  // ── апрув-кнопки ──
  bot.callbackQuery(/^pub:(.+)$/, async (ctx) => {
    const postId = ctx.match![1];
    await ctx.answerCallbackQuery({ text: "Публикую…" });
    if (!(await ownedPost(ctx, postId))) {
      await ctx.reply("⚠️ Нет доступа к этому посту.");
      return;
    }
    const res = await publishPost(postId);
    if (res.ok) {
      await ctx.reply("✅ Опубликовано в канал (с кнопкой и закреплением).");
    } else {
      await ctx.reply(`❌ Не удалось опубликовать: ${res.error}`);
    }
  });

  bot.callbackQuery(/^gimg:(.+)$/, async (ctx) => {
    const postId = ctx.match![1];
    await ctx.answerCallbackQuery({ text: "Генерирую картинку…" });
    if (!(await ownedPost(ctx, postId))) {
      await ctx.reply("⚠️ Нет доступа к этому посту.");
      return;
    }
    const res = await attachGeneratedImage(postId);
    if ("error" in res) {
      await ctx.reply(`❌ ${res.error}`);
      return;
    }
    await sendPreview(ctx, postId);
  });

  bot.callbackQuery(/^umd:(.+)$/, async (ctx) => {
    const postId = ctx.match![1];
    await ctx.answerCallbackQuery();
    if (!(await ownedPost(ctx, postId))) {
      await ctx.reply("⚠️ Нет доступа к этому посту.");
      return;
    }
    await ctx.reply(
      `Пришли фото или видео в ответ на это сообщение. ${MARK.media(postId)}`,
      { reply_markup: { force_reply: true } },
    );
  });

  bot.callbackQuery(/^regen:(.+)$/, async (ctx) => {
    const postId = ctx.match![1];
    await ctx.answerCallbackQuery({ text: "Перегенерирую…" });
    if (!(await ownedPost(ctx, postId))) {
      await ctx.reply("⚠️ Нет доступа к этому посту.");
      return;
    }
    const res = await regenerateDraft(postId);
    if ("error" in res) {
      await ctx.reply(`❌ ${res.error}`);
      return;
    }
    await sendPreview(ctx, postId);
  });

  bot.callbackQuery(/^own:(.+)$/, async (ctx) => {
    const postId = ctx.match![1];
    await ctx.answerCallbackQuery();
    if (!(await ownedPost(ctx, postId))) {
      await ctx.reply("⚠️ Нет доступа к этому посту.");
      return;
    }
    await ctx.reply(
      `Пришли свой текст поста в ответ на это сообщение — оформлю и подберу хэштеги. ${MARK.own(postId)}`,
      { reply_markup: { force_reply: true } },
    );
  });

  bot.callbackQuery(/^del:(.+)$/, async (ctx) => {
    const postId = ctx.match![1];
    await ctx.answerCallbackQuery({ text: "Удалено" });
    if (!(await ownedPost(ctx, postId))) {
      await ctx.reply("⚠️ Нет доступа к этому посту.");
      return;
    }
    await prisma.post.deleteMany({ where: { id: postId, status: { not: "published" } } });
    await ctx.reply("🗑 Черновик удалён.");
  });

  // ── список каналов + отвязка ──
  bot.callbackQuery(/^chdetach:(.+)$/, async (ctx) => {
    const channelId = ctx.match![1];
    await ctx.answerCallbackQuery();
    const ch = await ownedChannel(ctx, channelId);
    if (!ch) {
      await ctx.reply("⚠️ Нет доступа к этому каналу.");
      return;
    }
    await prisma.tgChannel.delete({ where: { id: channelId } });
    await ctx.reply(`🔌 Канал «${ch.title ?? ch.username ?? ch.chatId}» отвязан. Можешь удалить бота из админов канала.`);
  });

  // ── свои медиа: handled below in message handler with ownership check ──

  // ── повідомлення: канал-форвард / @username / відповіді на force_reply ──
  bot.on("message", async (ctx) => {
    const tenant = await tenantFor(ctx);
    if (!tenant) return;

    // 1) Відповідь на prompt із маркером (force_reply)
    const mark = parseMark(ctx.msg.reply_to_message?.text);
    if (mark) {
      if (mark.kind === "topic" && mark.arg && ctx.msg.text) {
        await startDraftFor(ctx, mark.arg as PostType, ctx.msg.text.trim());
        return;
      }
      if (mark.kind === "own" && mark.arg && ctx.msg.text) {
        if (!(await ownedPost(ctx, mark.arg))) {
          await ctx.reply("⚠️ Нет доступа к этому посту.");
          return;
        }
        await ctx.reply("⏳ Оформляю…");
        const res = await setOwnText(mark.arg, ctx.msg.text.trim());
        if ("error" in res) await ctx.reply(`❌ ${res.error}`);
        else await sendPreview(ctx, mark.arg);
        return;
      }
      if (mark.kind === "media" && mark.arg) {
        if (!(await ownedPost(ctx, mark.arg))) {
          await ctx.reply("⚠️ Нет доступа к этому посту.");
          return;
        }
        await handleUploadedMedia(ctx, mark.arg);
        return;
      }
      if (mark.kind === "channel") {
        // нижче обробиться як @username/forward
      }
    }

    // 2) Форвард із каналу → підключити
    const fo = ctx.msg.forward_origin;
    if (fo && fo.type === "channel") {
      await connectChannel(ctx, String(fo.chat.id));
      return;
    }

    // 3) @username / t.me-посилання
    const text = ctx.msg.text?.trim();
    if (text && (text.startsWith("@") || text.includes("t.me/"))) {
      const uname = text.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
      try {
        const chat = await ctx.api.getChat(`@${uname}`);
        await connectChannel(ctx, String(chat.id), chat);
      } catch {
        await ctx.reply("❌ Не нашёл такой канал. Перешли пост из канала или проверь @username.");
      }
      return;
    }
  });
}

// ─── підключення каналу ─────────────────────────────────────────────

async function connectChannel(
  ctx: Context,
  chatId: string,
  chatInfo?: { title?: string; username?: string },
) {
  const tenant = await tenantFor(ctx);
  if (!tenant) return;
  try {
    const me = await ctx.api.getChatMember(chatId, ctx.me.id);
    const isAdmin = me.status === "administrator" || me.status === "creator";
    if (!isAdmin) {
      await ctx.reply("⚠️ Бот не админ в этом канале. Добавь его в администраторы и повтори.");
      return;
    }
    const canPost = me.status === "creator" || !!(me as { can_post_messages?: boolean }).can_post_messages;
    const canPin = me.status === "creator" || !!(me as { can_pin_messages?: boolean }).can_pin_messages;

    const chat = chatInfo ?? (await ctx.api.getChat(chatId));
    const existingCount = await prisma.tgChannel.count({ where: { tenantId: tenant.id } });

    await prisma.tgChannel.upsert({
      where: { tenantId_chatId: { tenantId: tenant.id, chatId } },
      create: {
        tenantId: tenant.id,
        chatId,
        username: chat.username,
        title: chat.title,
        canPost,
        canPin,
        isDefault: existingCount === 0,
      },
      update: { username: chat.username, title: chat.title, canPost, canPin },
    });

    await ctx.reply(
      `✅ Канал подключён: <b>${chat.title ?? chat.username ?? chatId}</b>\n` +
        `Публикация: ${canPost ? "да" : "нет"} · Закрепление: ${canPin ? "да" : "нет"}\n\n` +
        "Создай первый пост: /new",
      { parse_mode: "HTML" },
    );
  } catch (e) {
    await ctx.reply(`❌ Не удалось подключить: ${e instanceof Error ? e.message : e}`);
  }
}

// ─── завантаження медіа від користувача ─────────────────────────────

async function handleUploadedMedia(ctx: Context, postId: string) {
  const msg = ctx.msg;
  if (!msg) return;
  let fileId: string | undefined;
  let mediaType: "image" | "video" = "image";
  let mime = "image/jpeg";

  if (msg.photo?.length) {
    fileId = msg.photo[msg.photo.length - 1].file_id;
    mediaType = "image";
    mime = "image/jpeg";
  } else if (msg.video) {
    fileId = msg.video.file_id;
    mediaType = "video";
    mime = msg.video.mime_type ?? "video/mp4";
  }
  if (!fileId) {
    await ctx.reply("⚠️ Пришли именно фото или видео.");
    return;
  }
  try {
    const file = await ctx.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${env.telegramBotToken}/${file.file_path}`;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const key = await putMedia(buf, mime);
    await prisma.post.update({
      where: { id: postId },
      data: { mediaType, mediaRef: key, mediaMime: mime },
    });
    await sendPreview(ctx, postId);
  } catch (e) {
    await ctx.reply(`❌ Не удалось сохранить медиа: ${e instanceof Error ? e.message : e}`);
  }
}
