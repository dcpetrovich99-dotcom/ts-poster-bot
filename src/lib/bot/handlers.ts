import "server-only";
import { InlineKeyboard, InputFile, type Bot, type Context } from "grammy";
import { prisma } from "../db";
import { env } from "../env";
import { getOrCreateTenantByTgId, getDefaultChannel, getContactCta } from "../tenant";
import {
  startLearn,
  addLearnSample,
  finalizeLearn,
  isLearning,
  learnFromLink,
  learnBanner,
  setEmojiPack,
  setPremiumEmoji,
} from "../style";
import {
  getHashtagPreset,
  setHashtagPreset,
  normalizeTags,
} from "../hashtags";
import { getMedia, putMedia } from "../media";
import { resolveApiKey } from "../ai/keys";
import { generateContentPlan } from "../ai/anthropic";
import {
  createDraft,
  regenerateDraft,
  setOwnText,
  attachGeneratedImage,
} from "../generate";
import { publishPost } from "./publish";
import { parseJsonArray, POST_TYPE_LABEL, POST_TYPES } from "../posts";
import {
  postTypeKeyboard,
  previewKeyboard,
  topicKeyboard,
  settingsKeyboard,
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

  // WYSIWYG: якщо є медіа — показуємо ОДНИМ повідомленням фото+підпис (як у канале).
  if (post.mediaType !== "none" && post.mediaRef) {
    const m = await getMedia(post.mediaRef);
    if (m) {
      let caption = `${post.bodyHtml}${hashtags ? `\n\n${hashtags}` : ""}`;
      if (caption.length > 1024) caption = caption.slice(0, 1010) + "…";
      const file = new InputFile(m.data);
      try {
        if (post.mediaType === "video") {
          await ctx.replyWithVideo(file, {
            caption,
            parse_mode: "HTML",
            reply_markup: previewKeyboard(postId),
          });
        } else {
          await ctx.replyWithPhoto(file, {
            caption,
            parse_mode: "HTML",
            reply_markup: previewKeyboard(postId),
          });
        }
        await ctx.reply(`${head}👆 Так пост будет выглядеть в канале.`, { parse_mode: "HTML" });
        return;
      } catch {
        /* фолбек на текстове прев'ю нижче */
      }
    }
  }

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
        "• /learn — обучить бота стилю (тексты)",
        "• /banner — эталон стиля картинок",
        "• /hashtags — хештеги по типам",
        "• /emoji — набор эмодзи канала",
        "• /settings — кнопка «написать нам»",
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

  bot.command("learn", async (ctx) => {
    const tenant = await tenantFor(ctx);
    if (!tenant) return;
    await startLearn(tenant.id);
    await ctx.reply(
      "🎓 <b>Режим обучения стилю.</b>\n\n" +
        "Перешли мне 1–N постов из твоего канала (с текстом и/или картинками) — я изучу tone of voice и визуальную айдентику (цвета, стиль).\n\n" +
        "Когда закончишь — отправь /done.",
      { parse_mode: "HTML" },
    );
  });

  bot.command("done", async (ctx) => {
    const tenant = await tenantFor(ctx);
    if (!tenant) return;
    if (!(await isLearning(tenant.id))) {
      await ctx.reply("Сейчас не режим обучения. Запусти /learn.");
      return;
    }
    await ctx.reply("⏳ Анализирую стиль (тексты + изображения)…");
    const res = await finalizeLearn(tenant.id);
    if ("error" in res) {
      await ctx.reply(`❌ ${res.error}`);
      return;
    }
    await ctx.reply(
      `✅ Стиль текста изучен.\n\n<b>Tone of voice:</b> ${res.toneSummary || "—"}\n<b>Визуал:</b> ${res.brandSummary || "—"}\n\n` +
        "Дальше — отдельно настрой <b>tone of voice баннера</b>: команда /banner (пришли эталонную картинку, я запомню её стиль для всех будущих изображений).\n\nПотом /new — пишет в этом стиле.",
      { parse_mode: "HTML" },
    );
  });

  bot.command("learnlink", async (ctx) => {
    const tenant = await tenantFor(ctx);
    if (!tenant) return;
    const text = ctx.match?.toString().trim();
    if (text) {
      await ctx.reply("⏳ Сканирую публичный канал…");
      const res = await learnFromLink(tenant.id, text);
      if ("error" in res) await ctx.reply(`❌ ${res.error}`);
      else
        await ctx.reply(
          `✅ Изучено ${res.texts} постов и ${res.images} картинок.\n<b>Tone of voice:</b> ${res.toneSummary || "—"}`,
          { parse_mode: "HTML" },
        );
      return;
    }
    await ctx.reply(
      `Пришли @username публичного канала в ответ на это сообщение — я просканирую его последние посты. ${MARK.learnLink()}`,
      { reply_markup: { force_reply: true } },
    );
  });

  bot.command("settings", async (ctx) => {
    const tenant = await tenantFor(ctx);
    if (!tenant) return;
    const cta = await getContactCta(tenant.id);
    await ctx.reply(
      `⚙️ <b>Настройки</b>\n\nCTA-кнопка «написать нам»: <b>${tenant.ctaEnabled ? "включена" : "выключена"}</b>\nТекст: ${cta.label}\nСсылка: ${cta.url}`,
      { parse_mode: "HTML", reply_markup: settingsKeyboard(tenant.ctaEnabled) },
    );
  });

  bot.callbackQuery("cta:toggle", async (ctx) => {
    const tenant = await tenantFor(ctx);
    if (!tenant) return;
    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { ctaEnabled: !tenant.ctaEnabled },
    });
    await ctx.answerCallbackQuery({ text: updated.ctaEnabled ? "Кнопка включена" : "Кнопка выключена" });
    const cta = await getContactCta(tenant.id);
    await ctx.editMessageText(
      `⚙️ <b>Настройки</b>\n\nCTA-кнопка «написать нам»: <b>${updated.ctaEnabled ? "включена" : "выключена"}</b>\nТекст: ${cta.label}\nСсылка: ${cta.url}`,
      { parse_mode: "HTML", reply_markup: settingsKeyboard(updated.ctaEnabled) },
    );
  });

  bot.callbackQuery("cta:settext", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(`Пришли новый текст кнопки в ответ на это сообщение. ${MARK.ctaText()}`, {
      reply_markup: { force_reply: true },
    });
  });

  bot.callbackQuery("cta:seturl", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(`Пришли ссылку для кнопки (t.me/...) в ответ на это сообщение. ${MARK.ctaUrl()}`, {
      reply_markup: { force_reply: true },
    });
  });

  bot.command("banner", async (ctx) => {
    const tenant = await tenantFor(ctx);
    if (!tenant) return;
    await ctx.reply(
      `🖼 Пришли эталонный баннер (картинку) в ответ на это сообщение. Я подробно опишу его tone of voice и буду ВСЕГДА использовать как референс для будущих изображений. ${MARK.banner()}`,
      { reply_markup: { force_reply: true } },
    );
  });

  bot.command("hashtags", async (ctx) => {
    const tenant = await tenantFor(ctx);
    if (!tenant) return;
    const lines: string[] = [];
    const kb = new InlineKeyboard();
    POST_TYPES.forEach((t, i) => {
      kb.text(POST_TYPE_LABEL[t], `htedit:${t}`);
      if (i % 2 === 1) kb.row();
    });
    for (const t of POST_TYPES) {
      const tags = await getHashtagPreset(tenant.id, t);
      lines.push(`<b>${POST_TYPE_LABEL[t]}</b>: ${tags.join(" ")}`);
    }
    await ctx.reply(`🏷 <b>Хештеги по типам</b>\n\n${lines.join("\n")}\n\nНажми тип, чтобы изменить.`, {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  });

  bot.callbackQuery(/^htedit:(.+)$/, async (ctx) => {
    const type = ctx.match![1];
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `Пришли хештеги для «${POST_TYPE_LABEL[type as never] ?? type}» через пробел (например: #кейс #трафик). ${MARK.htag(type)}`,
      { reply_markup: { force_reply: true } },
    );
  });

  bot.command("emoji", async (ctx) => {
    const tenant = await tenantFor(ctx);
    if (!tenant) return;
    const sp = await prisma.styleProfile.findUnique({ where: { tenantId: tenant.id } });
    const pack = parseJsonArray<string>(sp?.emojiPackJson).join(" ") || "—";
    const prem =
      parseJsonArray<{ emoji: string; id: string }>(sp?.premiumEmojiJson)
        .map((e) => e.emoji)
        .join(" ") || "—";
    const kb = new InlineKeyboard()
      .text("😀 Обычные эмодзи", "emoji:set")
      .row()
      .text("⭐ Премиум-эмодзи", "emoji:setprem");
    await ctx.reply(
      `😀 <b>Эмодзи канала</b>\nОбычные: ${pack}\nПремиум: ${prem}\n\n` +
        "⚠️ Премиум/кастомные эмодзи в постах <b>канала</b> работают, только если у бота есть купленный на Fragment username. Иначе Telegram покажет обычный эмодзи-фолбек.",
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  bot.callbackQuery("emoji:set", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(`Пришли набор обычных эмодзи через пробел (например: 🔥 🚀 💸 ✅). ${MARK.emoji()}`, {
      reply_markup: { force_reply: true },
    });
  });

  bot.callbackQuery("emoji:setprem", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `Пришли премиум-эмодзи в формате «эмодзи=custom_emoji_id», по одному в строке.\nНапример:\n🔥=5368324170671202286\n💎=5366316836101038579 ${MARK.pemoji()}`,
      { reply_markup: { force_reply: true } },
    );
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

  bot.callbackQuery(/^phash:(.+)$/, async (ctx) => {
    const postId = ctx.match![1];
    await ctx.answerCallbackQuery();
    if (!(await ownedPost(ctx, postId))) {
      await ctx.reply("⚠️ Нет доступа к этому посту.");
      return;
    }
    await ctx.reply(
      `Пришли хештеги для этого поста через пробел (заменят текущие). ${MARK.phash(postId)}`,
      { reply_markup: { force_reply: true } },
    );
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
      if (mark.kind === "ctatext" && ctx.msg.text) {
        await prisma.linkSetting.upsert({
          where: { tenantId_key: { tenantId: tenant.id, key: "contact_us" } },
          create: { tenantId: tenant.id, key: "contact_us", label: ctx.msg.text.trim(), url: "https://t.me/" },
          update: { label: ctx.msg.text.trim() },
        });
        await ctx.reply("✅ Текст кнопки обновлён.");
        return;
      }
      if (mark.kind === "ctaurl" && ctx.msg.text) {
        await prisma.linkSetting.upsert({
          where: { tenantId_key: { tenantId: tenant.id, key: "contact_us" } },
          create: { tenantId: tenant.id, key: "contact_us", label: "Написать нам", url: ctx.msg.text.trim() },
          update: { url: ctx.msg.text.trim() },
        });
        await ctx.reply("✅ Ссылка кнопки обновлена.");
        return;
      }
      if (mark.kind === "learnlink" && ctx.msg.text) {
        await ctx.reply("⏳ Сканирую публичный канал…");
        const res = await learnFromLink(tenant.id, ctx.msg.text.trim());
        if ("error" in res) await ctx.reply(`❌ ${res.error}`);
        else
          await ctx.reply(
            `✅ Изучено ${res.texts} постов и ${res.images} картинок.\n<b>Tone of voice:</b> ${res.toneSummary || "—"}`,
            { parse_mode: "HTML" },
          );
        return;
      }
      if (mark.kind === "banner") {
        if (!ctx.msg.photo?.length) {
          await ctx.reply("⚠️ Пришли именно картинку (баннер).");
          return;
        }
        await ctx.reply("⏳ Анализирую баннер…");
        try {
          const fileId = ctx.msg.photo[ctx.msg.photo.length - 1].file_id;
          const file = await ctx.api.getFile(fileId);
          const url = `https://api.telegram.org/file/bot${env.telegramBotToken}/${file.file_path}`;
          const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
          const key = await putMedia(buf, "image/jpeg");
          const res = await learnBanner(tenant.id, key);
          if ("error" in res) await ctx.reply(`❌ ${res.error}`);
          else
            await ctx.reply(
              `✅ Баннер сохранён как эталон.\n<b>Tone of voice баннера:</b> ${res.bannerTov.slice(0, 600)}`,
              { parse_mode: "HTML" },
            );
        } catch (e) {
          await ctx.reply(`❌ ${e instanceof Error ? e.message : e}`);
        }
        return;
      }
      if (mark.kind === "htag" && mark.arg && ctx.msg.text) {
        await setHashtagPreset(tenant.id, mark.arg as never, normalizeTags(ctx.msg.text));
        await ctx.reply("✅ Хештеги для типа обновлены.");
        return;
      }
      if (mark.kind === "emoji" && ctx.msg.text) {
        const e = await setEmojiPack(tenant.id, ctx.msg.text);
        await ctx.reply(`✅ Набор эмодзи сохранён: ${e.join(" ")}`);
        return;
      }
      if (mark.kind === "pemoji" && ctx.msg.text) {
        const p = await setPremiumEmoji(tenant.id, ctx.msg.text);
        await ctx.reply(`✅ Премиум-эмодзи сохранены: ${p.map((x) => x.emoji).join(" ") || "—"}`);
        return;
      }
      if (mark.kind === "phash" && mark.arg && ctx.msg.text) {
        if (!(await ownedPost(ctx, mark.arg))) {
          await ctx.reply("⚠️ Нет доступа к этому посту.");
          return;
        }
        await prisma.post.update({
          where: { id: mark.arg },
          data: { hashtagsJson: JSON.stringify(normalizeTags(ctx.msg.text)) },
        });
        await sendPreview(ctx, mark.arg);
        return;
      }
      if (mark.kind === "channel") {
        // нижче обробиться як @username/forward
      }
    }

    // 2) Режим навчання: будь-який пост (текст/фото, у т.ч. форвард) — це зразок стилю.
    if (await isLearning(tenant.id)) {
      const text = ctx.msg.text ?? ctx.msg.caption ?? "";
      let imageKey: string | undefined;
      if (ctx.msg.photo?.length) {
        try {
          const fileId = ctx.msg.photo[ctx.msg.photo.length - 1].file_id;
          const file = await ctx.api.getFile(fileId);
          const url = `https://api.telegram.org/file/bot${env.telegramBotToken}/${file.file_path}`;
          const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
          imageKey = await putMedia(buf, "image/jpeg");
        } catch {}
      }
      if (text || imageKey) {
        const c = await addLearnSample(tenant.id, { text, imageKey });
        await ctx.reply(`📥 Принято (текстов: ${c.texts}, картинок: ${c.images}). Ещё постов или /done.`);
      } else {
        await ctx.reply("Пришли пост с текстом или картинкой, или заверши /done.");
      }
      return;
    }

    // 3) Форвард із каналу → підключити
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
