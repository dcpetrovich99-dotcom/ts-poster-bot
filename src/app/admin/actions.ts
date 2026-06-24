"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import {
  createSession,
  destroySession,
  getCurrentAdmin,
  requireAdmin,
  verifyPassword,
} from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { analyzeStyle } from "@/lib/ai/anthropic";
import { resolveApiKey } from "@/lib/ai/keys";
import { parseJsonArray } from "@/lib/posts";
import { publishPost } from "@/lib/bot/publish";
import type { AiProvider } from "@/generated/prisma/client";

export async function loginAction(formData: FormData) {
  const login = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const user = await prisma.adminUser.findUnique({ where: { login } });
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    redirect("/admin/login?error=1");
  }
  const h = await headers();
  await createSession(user!.id, {
    userAgent: h.get("user-agent") ?? undefined,
    ip: h.get("x-forwarded-for") ?? undefined,
  });
  redirect("/admin");
}

export async function logoutAction() {
  await destroySession();
  redirect("/admin/login");
}

/** Гарантує, що пост належить tenant поточного адміна. */
async function assertPostOwned(postId: string, tenantId: string) {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.tenantId !== tenantId) throw new Error("Нет доступа к посту");
  return post;
}

export async function publishAction(formData: FormData) {
  const admin = await requireAdmin();
  const postId = String(formData.get("postId"));
  await assertPostOwned(postId, admin.tenantId);
  await publishPost(postId);
  revalidatePath("/admin/posts");
}

export async function deletePostAction(formData: FormData) {
  const admin = await requireAdmin();
  const postId = String(formData.get("postId"));
  await assertPostOwned(postId, admin.tenantId);
  await prisma.post.deleteMany({ where: { id: postId, status: { not: "published" } } });
  revalidatePath("/admin/posts");
}

export async function saveLinkAction(formData: FormData) {
  const admin = await requireAdmin();
  const key = String(formData.get("key")).trim();
  const label = String(formData.get("label")).trim();
  const url = String(formData.get("url")).trim();
  if (!key || !label || !url) return;
  await prisma.linkSetting.upsert({
    where: { tenantId_key: { tenantId: admin.tenantId, key } },
    create: { tenantId: admin.tenantId, key, label, url },
    update: { label, url },
  });
  revalidatePath("/admin/links");
}

export async function saveKeyAction(formData: FormData) {
  const admin = await requireAdmin();
  const provider = String(formData.get("provider")) as AiProvider;
  const key = String(formData.get("key")).trim();
  if (!key) return;
  await prisma.apiCredential.upsert({
    where: { tenantId_provider: { tenantId: admin.tenantId, provider } },
    create: { tenantId: admin.tenantId, provider, keyEncrypted: encryptSecret(key), isActive: true },
    update: { keyEncrypted: encryptSecret(key), isActive: true },
  });
  revalidatePath("/admin/keys");
}

export async function topupAction(formData: FormData) {
  const admin = await requireAdmin();
  const amount = Math.round(Number(formData.get("amount")));
  if (!Number.isFinite(amount) || amount <= 0) return;
  await prisma.balanceEntry.create({
    data: { tenantId: admin.tenantId, amount, reason: "topup" },
  });
  revalidatePath("/admin/keys");
}

export async function setDefaultChannelAction(formData: FormData) {
  const admin = await requireAdmin();
  const channelId = String(formData.get("channelId"));
  const ch = await prisma.tgChannel.findUnique({ where: { id: channelId } });
  if (!ch || ch.tenantId !== admin.tenantId) return;
  await prisma.tgChannel.updateMany({
    where: { tenantId: admin.tenantId },
    data: { isDefault: false },
  });
  await prisma.tgChannel.update({ where: { id: channelId }, data: { isDefault: true } });
  revalidatePath("/admin/channels");
}

export async function detachChannelAction(formData: FormData) {
  const admin = await requireAdmin();
  const channelId = String(formData.get("channelId"));
  const ch = await prisma.tgChannel.findUnique({ where: { id: channelId } });
  // superadmin може відвʼязати будь-який канал; звичайний адмін — лише свій tenant
  if (!ch || (admin.role !== "superadmin" && ch.tenantId !== admin.tenantId)) return;
  await prisma.tgChannel.delete({ where: { id: channelId } });
  revalidatePath("/admin/channels");
  revalidatePath("/admin/super");
}

export async function saveStyleManualAction(formData: FormData) {
  const admin = await requireAdmin();
  const topic = String(formData.get("topic") ?? "").trim();
  const refsRaw = String(formData.get("references") ?? "").trim();
  const references = refsRaw
    ? refsRaw.split(/\n-{3,}\n|\n\n+/).map((s) => s.trim()).filter(Boolean)
    : [];
  await prisma.styleProfile.upsert({
    where: { tenantId: admin.tenantId },
    create: {
      tenantId: admin.tenantId,
      source: "manual",
      topic,
      referencesJson: JSON.stringify(references),
      samplesCount: references.length,
    },
    update: { topic, referencesJson: JSON.stringify(references), samplesCount: references.length },
  });
  revalidatePath("/admin/style");
}

export async function analyzeStyleAction() {
  const admin = await requireAdmin();
  const sp = await prisma.styleProfile.findUnique({ where: { tenantId: admin.tenantId } });
  const samples = parseJsonArray<string>(sp?.referencesJson);
  if (!samples.length) return;
  const key = await resolveApiKey(admin.tenantId, "anthropic");
  if (!key) return;
  const analysis = await analyzeStyle(key, samples, sp?.topic ?? undefined);
  await prisma.styleProfile.update({
    where: { tenantId: admin.tenantId },
    data: { analysisJson: JSON.stringify(analysis) },
  });
  revalidatePath("/admin/style");
}
