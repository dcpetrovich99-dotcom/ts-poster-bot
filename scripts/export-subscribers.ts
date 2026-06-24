import "dotenv/config";
import ExcelJS from "exceljs";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { decryptSecret } from "../src/lib/crypto";

// Локальна вигрузка підписників каналу у .xlsx (KYC/безпека). Bot API цього не вміє —
// працює через MTProto user-сесію власника (спершу `npm run style:scrape` для входу).
//
// Запуск: npm run subs:export -- --channel @x --owner <tgUserId> [--limit 5000] [--out file.xlsx]

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!apiId || !apiHash) throw new Error("Потрібні TELEGRAM_API_ID / TELEGRAM_API_HASH");

  const channelArg = arg("channel");
  const owner = arg("owner");
  const limit = Number(arg("limit", "5000"));
  const out = arg("out") || `subscribers-${Date.now()}.xlsx`;
  if (!channelArg || !owner) throw new Error("Вкажи --channel @username і --owner <tgUserId>");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const tenant = await prisma.tenant.findFirst({ where: { ownerTgId: String(owner) } });
  if (!tenant) throw new Error(`Tenant для owner=${owner} не знайдено`);
  const sess = await prisma.tgUserSession.findUnique({ where: { tenantId: tenant.id } });
  if (!sess) throw new Error("Немає MTProto-сесії — спершу `npm run style:scrape`");

  const client = new TelegramClient(
    new StringSession(decryptSecret(sess.sessionEncrypted)),
    apiId,
    apiHash,
    { connectionRetries: 3 },
  );
  await client.connect();

  console.log(`Читаю підписників ${channelArg} (до ${limit})…`);
  const participants = await client.getParticipants(channelArg, { limit });
  await client.disconnect();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Subscribers");
  ws.columns = [
    { header: "User ID", key: "id", width: 18 },
    { header: "Username", key: "username", width: 22 },
    { header: "First name", key: "firstName", width: 20 },
    { header: "Last name", key: "lastName", width: 20 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Bot", key: "bot", width: 8 },
    { header: "Deleted", key: "deleted", width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const u of participants) {
    const x = u as {
      id?: { toString(): string };
      username?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      bot?: boolean;
      deleted?: boolean;
    };
    ws.addRow({
      id: x.id?.toString() ?? "",
      username: x.username ?? "",
      firstName: x.firstName ?? "",
      lastName: x.lastName ?? "",
      phone: x.phone ?? "",
      bot: !!x.bot,
      deleted: !!x.deleted,
    });
  }
  await wb.xlsx.writeFile(out);
  console.log(`✅ ${participants.length} підписників → ${out}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
