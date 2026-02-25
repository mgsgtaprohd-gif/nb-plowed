export async function onRequestGet({ env }) {
  const db = env.DB;

  const sql = `
    WITH recent AS (
      SELECT street_id, vote
      FROM votes
      WHERE created_at >= datetime('now','-24 hours')
    ),
    agg AS (
      SELECT
        street_id,
        SUM(CASE WHEN vote='plowed' THEN 1 ELSE 0 END) AS plowedVotes,
        SUM(CASE WHEN vote='not_plowed' THEN 1 ELSE 0 END) AS notPlowedVotes,
        COUNT(*) AS totalVotesLast24h
      FROM recent
      GROUP BY street_id
    )
    SELECT
      street_id,
      plowedVotes,
      notPlowedVotes,
      totalVotesLast24h,
      CASE
        WHEN totalVotesLast24h = 0 THEN 'unknown'
        WHEN plowedVotes = notPlowedVotes THEN 'mixed'
        WHEN plowedVotes > notPlowedVotes THEN 'plowed'
        ELSE 'not_plowed'
      END AS state
    FROM agg;
  `;

  const { results } = await db.prepare(sql).all();
  const byStreetId = {};
  for (const r of results) {
    byStreetId[r.street_id] = {
      state: r.state,
      plowedVotes: r.plowedVotes,
      notPlowedVotes: r.notPlowedVotes,
      totalVotesLast24h: r.totalVotesLast24h
    };
  }

  return new Response(JSON.stringify({ byStreetId }), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
