import "server-only";
import { prisma } from "./db";

// Сховище медіа в Postgres (таблиця MediaBlob) — персистентно на будь-якому хості
// (Railway/Netlify), без ефемерного диска. Ключ = id рядка.

export type MediaRecord = { data: Buffer; mime: string };

export async function putMedia(data: Buffer, mime: string): Promise<string> {
  const row = await prisma.mediaBlob.create({
    data: { mime, data: new Uint8Array(data) },
    select: { id: true },
  });
  return row.id;
}

export async function getMedia(key: string): Promise<MediaRecord | null> {
  const row = await prisma.mediaBlob.findUnique({ where: { id: key } });
  if (!row) return null;
  return { data: Buffer.from(row.data), mime: row.mime };
}
