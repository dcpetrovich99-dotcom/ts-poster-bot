import "server-only";
import { randomToken } from "./crypto";

// Сховище медіа. На Netlify — Netlify Blobs (getStore). Локально (next dev),
// де немає Netlify-контексту, — фолбек у каталог .data/blobs.

const STORE = "tg-poster-media";

type MediaRecord = { data: Buffer; mime: string };

async function netlifyStore() {
  const { getStore } = await import("@netlify/blobs");
  return getStore(STORE);
}

export async function putMedia(data: Buffer, mime: string): Promise<string> {
  const key = `${Date.now()}-${randomToken(8)}`;
  try {
    const store = await netlifyStore();
    // Netlify Blobs очікує ArrayBuffer/Blob/string — конвертуємо Buffer у точний ArrayBuffer.
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    await store.set(key, ab, { metadata: { mime } });
    return key;
  } catch {
    // Локальний фолбек
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), ".data", "blobs");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, key), data);
    await fs.writeFile(path.join(dir, `${key}.meta`), mime, "utf8");
    return key;
  }
}

export async function getMedia(key: string): Promise<MediaRecord | null> {
  try {
    const store = await netlifyStore();
    const res = await store.getWithMetadata(key, { type: "arrayBuffer" });
    if (!res) return null;
    const mime = (res.metadata?.mime as string) ?? "application/octet-stream";
    return { data: Buffer.from(res.data), mime };
  } catch {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), ".data", "blobs");
    try {
      const data = await fs.readFile(path.join(dir, key));
      const mime = await fs
        .readFile(path.join(dir, `${key}.meta`), "utf8")
        .catch(() => "application/octet-stream");
      return { data, mime };
    } catch {
      return null;
    }
  }
}
