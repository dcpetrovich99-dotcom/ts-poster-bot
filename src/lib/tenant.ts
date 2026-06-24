import "server-only";
import { prisma } from "./db";
import { randomToken } from "./crypto";

// Резолвінг tenant за Telegram user id власника. Кожен tg-користувач = свій
// ізольований tenant (SaaS-ready). У фазі 1 фактично один власник.

export async function getOrCreateTenantByTgId(tgId: string | number, name?: string) {
  const ownerTgId = String(tgId);
  const existing = await prisma.tenant.findFirst({ where: { ownerTgId } });
  if (existing) return existing;

  const tenant = await prisma.tenant.create({
    data: {
      name: name?.slice(0, 80) || `Workspace ${ownerTgId}`,
      ownerTgId,
      activationToken: randomToken(24),
    },
  });

  // Дефолтні налаштування: CTA «написать нам», порожній StyleProfile.
  await prisma.linkSetting.create({
    data: {
      tenantId: tenant.id,
      key: "contact_us",
      label: "Написать нам",
      url: "https://t.me/", // власник відредагує приватне посилання в адмінці
    },
  });
  await prisma.styleProfile.create({
    data: { tenantId: tenant.id, source: "manual" },
  });

  return tenant;
}

/** CTA-посилання «написать нам» для tenant (label + url). */
export async function getContactCta(tenantId: string): Promise<{ label: string; url: string }> {
  const link = await prisma.linkSetting.findUnique({
    where: { tenantId_key: { tenantId, key: "contact_us" } },
  });
  return {
    label: link?.label || "Написать нам",
    url: link?.url || "https://t.me/",
  };
}

/** Канал за замовчуванням для постингу. */
export async function getDefaultChannel(tenantId: string) {
  return (
    (await prisma.tgChannel.findFirst({
      where: { tenantId, isDefault: true },
    })) ?? (await prisma.tgChannel.findFirst({ where: { tenantId } }))
  );
}
