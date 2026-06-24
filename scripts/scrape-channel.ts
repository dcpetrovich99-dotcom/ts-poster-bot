import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { encryptSecret } from "../src/lib/crypto";
import { analyzeStyle } from "../src/lib/ai/anthropic";

// MTProto-скрейп історії каналу під аналіз стилю.
// Bot API не віддає історію — тому використовуємо user-сесію власника (GramJS).
//
// Запуск:
//   npm run style:scrape -- --channel @yourchannel --owner <tgUserId> [--limit 80]
// Потрібні env: TELEGRAM_API_ID, TELEGRAM_API_HASH, ANTHROPIC_API_KEY, DATABASE_URL.
// Перший раз попросить телефон/код/2FA; збереже зашифровану сесію у БД.

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!apiId || !apiHash) throw new Error("Потрібні TELEGRAM_API_ID / TELEGRAM_API_HASH (my.telegram.org)");
  if (!anthropicKey) throw new Error("Потрібен ANTHROPIC_API_KEY у .env");

  const channel = arg("channel");
  const owner = arg("owner");
  const limit = Number(arg("limit", "80"));
  if (!channel || !owner) throw new Error("Вкажи --channel @username і --owner <tgUserId>");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const tenant = await prisma.tenant.findFirst({ where: { ownerTgId: String(owner) } });
  if (!tenant) throw new Error(`Tenant для owner=${owner} не знайдено — спершу /start у боті`);

  // Відновлюємо сесію, якщо вже збережена.
  const existing = await prisma.tgUserSession.findUnique({ where: { tenantId: tenant.id } });
  let sessionStr = "";
  if (existing) {
    try {
      const { decryptSecret } = await import("../src/lib/crypto");
      sessionStr = decryptSecret(existing.sessionEncrypted);
    } catch {}
  }

  const rl = readline.createInterface({ input, output });
  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => (await rl.question("Телефон (з +): ")).trim(),
    password: async () => (await rl.question("Пароль 2FA (якщо є): ")).trim(),
    phoneCode: async () => (await rl.question("Код з Telegram: ")).trim(),
    onError: (err) => console.error(err),
  });

  // Зберігаємо/оновлюємо зашифровану сесію.
  const saved = client.session.save() as unknown as string;
  await prisma.tgUserSession.upsert({
    where: { tenantId: tenant.id },
    create: { tenantId: tenant.id, sessionEncrypted: encryptSecret(saved) },
    update: { sessionEncrypted: encryptSecret(saved) },
  });

  console.log(`Читаю останні ${limit} постів з ${channel}…`);
  const messages = await client.getMessages(channel, { limit });
  const samples = messages
    .map((m) => (m as { message?: string }).message)
    .filter((t): t is string => !!t && t.trim().length > 20)
    .slice(0, 50);

  await rl.close();
  await client.disconnect();

  if (!samples.length) {
    console.log("Немає текстових постів для аналізу. Заповни референси вручну в адмінці.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Аналізую стиль за ${samples.length} постами (Claude)…`);
  const analysis = await analyzeStyle(anthropicKey, samples);

  await prisma.styleProfile.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      source: "scrape",
      analysisJson: JSON.stringify(analysis),
      referencesJson: JSON.stringify(samples.slice(0, 10)),
      samplesCount: samples.length,
    },
    update: {
      source: "scrape",
      analysisJson: JSON.stringify(analysis),
      referencesJson: JSON.stringify(samples.slice(0, 10)),
      samplesCount: samples.length,
    },
  });

  console.log("✅ Стиль збережено. Резюме:", analysis.summary);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
