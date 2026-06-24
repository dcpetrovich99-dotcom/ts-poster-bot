import ExcelJS from "exceljs";
import { getCurrentAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fetchChannelSubscribers } from "@/lib/subscribers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Вигрузка підписників каналу в .xlsx (KYC/безпекова перевірка).
// Доступ: superadmin (будь-який канал) або адмін свого tenant.
export async function GET(_req: Request, ctx: { params: Promise<{ channelId: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) return new Response("unauthorized", { status: 401 });
  const { channelId } = await ctx.params;

  const channel = await prisma.tgChannel.findUnique({ where: { id: channelId } });
  if (!channel) return new Response("channel not found", { status: 404 });
  if (admin.role !== "superadmin" && channel.tenantId !== admin.tenantId) {
    return new Response("forbidden", { status: 403 });
  }

  const res = await fetchChannelSubscribers(channel.tenantId, channelId);
  if (!res.ok) {
    return new Response(JSON.stringify({ error: res.error }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Subscribers");
  ws.columns = [
    { header: "User ID", key: "id", width: 18 },
    { header: "Username", key: "username", width: 22 },
    { header: "First name", key: "firstName", width: 20 },
    { header: "Last name", key: "lastName", width: 20 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Bot", key: "isBot", width: 8 },
    { header: "Deleted", key: "isDeleted", width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const s of res.subscribers) ws.addRow(s);

  const buf = await wb.xlsx.writeBuffer();
  const safe = res.channelTitle.replace(/[^\w\-]+/g, "_").slice(0, 40) || "channel";
  const filename = `subscribers_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new Response(buf, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
