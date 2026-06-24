# TG Poster — SaaS-бот автопостингу в Telegram

Бот веде Telegram-канал: щодня нагадує тему, генерує пост у **твоєму стилі**
(GPT — текст+картинка, Claude — оформлення/хештеги/контент-план), дає на апрув і
публікує **тільки після твого дозволу** — з синьою CTA-кнопкою «написать нам» і
закріпленням. Архітектура multi-tenant (SaaS-ready); фаза 1 — під одного власника.

## Стек
- Next.js 15 (App Router) — веб-адмін + вебхук бота + cron в одному деплої
- Prisma 7 + **Neon** Postgres (serverless driver)
- grammY (Telegram Bot API), OpenAI SDK (`gpt-4o` + `gpt-image-1`), Anthropic SDK (`claude-opus-4-8`)
- GramJS (MTProto) — скрейп історії каналу під аналіз стилю
- Tailwind v4; деплой на **Netlify** (Blobs для медіа, Scheduled Functions для крону)

## Як це працює
1. **Активація** — користувач пише боту `/start` → створюється його tenant.
2. **Підключення каналу** — додаєш бота в адміни каналу (публікація+закріплення),
   потім `/connect` і пересилаєш боту пост із каналу (або @username).
3. **Стиль** — `npm run style:scrape` (читає історію каналу через твій акаунт) або
   ручні референси в адмінці → Claude будує style-профіль.
4. **Пост** — `/new` → тип → тема (своя або 🤖) → GPT-чернетка → Claude-оформлення →
   прев'ю з кнопками: 🖼 картинка / 📎 своє медіа / 🔄 інший варіант / ✏️ свій текст /
   ✅ опублікувати / 🗑.
5. **Публікація** — `sendPhoto/sendMessage` у канал + інлайн url-кнопка (синя) +
   закріплення. CTA «написать нам» — і гіперлінком у тексті, і кнопкою.
6. **Нагадування** — щоденний cron шле тему з контент-плану з кнопками.

## Локальний запуск
```bash
cp .env.example .env          # заповни (див. нижче)
npm install
npm run db:migrate            # застосувати міграцію до Neon
npm run db:seed               # створити власника веб-адміна (SEED_ADMIN_*)
npm run dev                   # http://localhost:3000 ; адмінка /admin
```
Вебхук бота локально — через тунель:
```bash
cloudflared tunnel --url http://localhost:3000     # або ngrok http 3000
# постав APP_HOST=<домен-тунеля> у .env, тоді:
npm run bot:set-webhook
```

### Обов'язкові env (див. `.env.example`)
- `DATABASE_URL` — Neon pooled connection string
- `APP_ENCRYPTION_KEY` — 32-байтний hex (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- `AUTH_SECRET`, `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET` — випадкові рядки
- `TELEGRAM_BOT_TOKEN` — від @BotFather
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — глобальний фолбек (або задай per-tenant у адмінці)
- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` — лише для `style:scrape` (my.telegram.org)
- `SEED_ADMIN_LOGIN` / `SEED_ADMIN_PASSWORD` / `OWNER_TG_ID`

> ⚠️ BotFather: вимкни **Group Privacy** боту, щоб він отримував повідомлення.

## Навчання стилю з історії каналу
```bash
npm run style:scrape -- --channel @yourchannel --owner <твій tg user id> --limit 80
```
Перший раз попросить телефон/код/2FA (твій акаунт), збереже зашифровану сесію в БД.

## Деплой на Netlify
1. Підключи репозиторій до Netlify (build вже у `netlify.toml`, плагін `@netlify/plugin-nextjs`).
2. У Netlify → Environment variables постав усі env (як у `.env`), `APP_HOST`=твій netlify-домен.
3. Neon: застосуй міграцію (`npm run db:migrate` локально проти прод-URL) і `npm run db:seed`.
4. Постав вебхук на прод: `APP_HOST=<домен> npm run bot:set-webhook`.
5. Cron нагадувань — Netlify Scheduled Function `netlify/functions/cron-daily.mjs`
   (розклад у `netlify.toml`, смикає `/api/cron/daily` із `CRON_SECRET`).

## Структура
- `src/app/api/bot` — вебхук; `src/lib/bot/*` — grammY бот, публікація, клавіатури
- `src/lib/ai/*` — OpenAI/Anthropic, резолвер ключів per-tenant + баланс
- `src/lib/generate.ts` — генерація/оформлення/перегенерація чернеток
- `src/app/admin/*` — веб-адмін (логін, дашборд, пости/апрув, канали, стиль, посилання, ключі)
- `scripts/` — `set-webhook.ts`, `scrape-channel.ts`
