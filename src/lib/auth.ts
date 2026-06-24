import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { prisma } from "./db";
import { env } from "./env";
import { sha256, randomToken } from "./crypto";

// Автентифікація веб-адміна (патерн з agency-site). Кожен AdminUser привʼязаний
// до tenant — сесія несе tenantId для ізоляції даних.

const COOKIE = "tgp-auth";
const SESSION_DAYS = 7;

export async function hashPassword(pw: string): Promise<string> {
  return argonHash(pw);
}
export async function verifyPassword(h: string, pw: string): Promise<boolean> {
  try {
    return await argonVerify(h, pw);
  } catch {
    return false;
  }
}

export async function createSession(adminUserId: string, meta?: { userAgent?: string; ip?: string }) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await prisma.session.create({
    data: {
      adminUserId,
      tokenHash: sha256(token),
      userAgent: meta?.userAgent?.slice(0, 300),
      ip: meta?.ip?.slice(0, 64),
      expiresAt,
    },
  });
  const c = await cookies();
  c.set(COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export type CurrentAdmin = { id: string; login: string; role: string; tenantId: string };

export async function getCurrentAdmin(): Promise<CurrentAdmin | null> {
  const c = await cookies();
  const token = c.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { adminUser: true },
    });
    if (!session || session.expiresAt < new Date()) return null;
    return {
      id: session.adminUser.id,
      login: session.adminUser.login,
      role: session.adminUser.role,
      tenantId: session.adminUser.tenantId,
    };
  } catch {
    return null;
  }
}

export async function requireAdmin(): Promise<CurrentAdmin> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

/** Гард глобального власника сервісу (бачить усі tenants). */
export async function requireSuperadmin(): Promise<CurrentAdmin> {
  const admin = await requireAdmin();
  if (admin.role !== "superadmin") redirect("/admin");
  return admin;
}

export async function destroySession() {
  const c = await cookies();
  const token = c.get(COOKIE)?.value;
  if (token) {
    try {
      await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
    } catch {}
  }
  c.set(COOKIE, "", { path: "/", maxAge: 0 });
}
