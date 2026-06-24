import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { hash as argonHash } from "@node-rs/argon2";

// Сід початкового власника: tenant + AdminUser(owner) + дефолтні налаштування.
// Запуск: npm run db:seed (після db:migrate).

async function main() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const login = process.env.SEED_ADMIN_LOGIN || "admin";
  const password = process.env.SEED_ADMIN_PASSWORD || "change-me-12345";
  const ownerTgId = process.env.OWNER_TG_ID || null;

  const existing = await prisma.adminUser.findUnique({ where: { login } });
  if (existing) {
    console.log(`AdminUser "${login}" вже існує — пропускаю.`);
    await prisma.$disconnect();
    return;
  }

  // tenant: знайти за ownerTgId або створити «Owner workspace».
  let tenant = ownerTgId
    ? await prisma.tenant.findFirst({ where: { ownerTgId } })
    : null;
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: "Owner workspace", ownerTgId: ownerTgId ?? undefined },
    });
    await prisma.linkSetting.create({
      data: { tenantId: tenant.id, key: "contact_us", label: "Написать нам", url: "https://t.me/" },
    });
    await prisma.styleProfile.create({ data: { tenantId: tenant.id, source: "manual" } });
  }

  await prisma.adminUser.create({
    data: {
      tenantId: tenant.id,
      login,
      passwordHash: await argonHash(password),
      role: "owner",
    },
  });

  console.log(`✅ Створено AdminUser "${login}" для tenant ${tenant.id}.`);
  console.log("⚠️ Зміни пароль після першого входу.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
