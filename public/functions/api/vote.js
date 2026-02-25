async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,"0")).join("");
}

export async function onRequestPost({ request, env }) {
  const db = env.DB;

  const body = await request.json().catch(() => null);
  const streetId = body?.streetId;
  const vote = body?.vote;

  if (!streetId || (vote !== "plowed" && vote !== "not_plowed")) {
    return new Response(JSON.stringify({ error: "Invalid payload." }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  // IP-based throttling (basic)
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";

  const ipHash = await sha256Hex(ip + (env.IP_SALT || "change-me"));

  // Rules:
  // - 1 vote per IP per 10 minutes
  // - max 120 votes per IP per 24 hours
  const tooSoon = await db.prepare(`
    SELECT 1 FROM votes
    WHERE ip_hash = ? AND created_at >= datetime('now','-10 minutes')
    LIMIT 1;
  `).bind(ipHash).first();

  if (tooSoon) {
    return new Response(JSON.stringify({ error: "Rate limit: try again in ~10 minutes." }), {
      status: 429,
      headers: { "content-type": "application/json" }
    });
  }

  const dailyCount = await db.prepare(`
    SELECT COUNT(*) AS c FROM votes
    WHERE ip_hash = ? AND created_at >= datetime('now','-24 hours');
  `).bind(ipHash).first();

  if ((dailyCount?.c ?? 0) >= 120) {
    return new Response(JSON.stringify({ error: "Daily limit reached." }), {
      status: 429,
      headers: { "content-type": "application/json" }
    });
  }

  await db.prepare(`
    INSERT INTO votes (street_id, vote, ip_hash)
    VALUES (?, ?, ?);
  `).bind(streetId, vote, ipHash).run();

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" }
  });
}
