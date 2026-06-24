// Netlify Scheduled Function — щодня (розклад у netlify.toml) смикає Next-роут
// /api/cron/daily з секретом. Уся логіка нагадувань — у Next-застосунку.

export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    return new Response("no site URL", { status: 500 });
  }
  const res = await fetch(`${base}/api/cron/daily`, {
    method: "POST",
    headers: { "x-cron-secret": process.env.CRON_SECRET || "" },
  });
  const body = await res.text();
  return new Response(body, { status: res.status });
};
