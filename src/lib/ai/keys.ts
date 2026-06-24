import "server-only";
import { prisma } from "../db";
import { decryptSecret } from "../crypto";
import { env } from "../env";
import type { AiProvider } from "@/generated/prisma/client";

// Резолвить API-ключ провайдера для tenant: спершу шифрований ключ із БД,
// інакше — глобальний фолбек з env (зручно у фазі 1 під власника).
export async function resolveApiKey(
  tenantId: string,
  provider: AiProvider,
): Promise<string | null> {
  const cred = await prisma.apiCredential.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
  });
  if (cred?.isActive && cred.keyEncrypted) {
    try {
      return decryptSecret(cred.keyEncrypted);
    } catch {
      // пошкоджений шифротекст — падаємо на фолбек
    }
  }
  if (provider === "openai") return env.openaiKey || null;
  if (provider === "anthropic") return env.anthropicKey || null;
  return null;
}

// Списання кредитів балансу (best-effort облік вартості генерацій).
export async function chargeCredits(
  tenantId: string,
  amount: number,
  reason: string,
  meta?: Record<string, unknown>,
) {
  if (amount <= 0) return;
  await prisma.balanceEntry.create({
    data: {
      tenantId,
      amount: -Math.abs(amount),
      reason,
      meta: meta ? JSON.stringify(meta) : null,
    },
  });
}

export async function tenantBalance(tenantId: string): Promise<number> {
  const agg = await prisma.balanceEntry.aggregate({
    where: { tenantId },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}
