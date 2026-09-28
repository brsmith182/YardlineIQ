#!/usr/bin/env node
// Correct the four Week 3 sides supplied on Sep 27, 2026. The stored lines
// and final scores are checked before any write so this cannot silently apply
// to a different slate or overwrite a later edit.
const { createClient } = require('redis');
const { gradePick } = require('./grade-pick');

const corrections = [
  ['2026-w3-cin-at-pit', 'Cincinnati Bengals -3.5', 'Pittsburgh Steelers +3.5', 27, 30],
  ['2026-w3-bal-at-dal', 'Baltimore Ravens -3.5', 'Dallas Cowboys +3.5', 34, 31],
  ['2026-w3-min-at-tb', 'Tampa Bay Buccaneers +1.5', 'Minnesota Vikings -1.5', 23, 16],
  ['2026-w3-ten-at-nyg', 'Tennessee Titans +2.5', 'New York Giants -2.5', 7, 12],
];

async function main() {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required');
  const dryRun = process.argv.includes('--dry-run');
  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (e) => console.error('Redis error:', e.message));
  await client.connect();
  try {
    const ids = await client.sMembers('all_picks');
    const rows = (await Promise.all(ids.map(async (id) => {
      const raw = await client.get(`pick:${id}`);
      return raw ? { key: `pick:${id}`, pick: JSON.parse(raw) } : null;
    }))).filter(Boolean);
    const changes = corrections.map(([gameId, before, after, away, home]) => {
      const matches = rows.filter(({ pick }) => pick.gameId === gameId);
      if (matches.length !== 1) throw new Error(`${gameId}: expected one published pick, found ${matches.length}`);
      const { key, pick } = matches[0];
      if (pick.pick !== before || pick.result !== 'loss'
          || pick.finalScore?.away !== away || pick.finalScore?.home !== home) {
        throw new Error(`${gameId}: stored pick, result, or score changed; no corrections written`);
      }
      const updated = { ...pick, pick: after, result: gradePick({ ...pick, pick: after }, pick.finalScore) };
      if (updated.result !== 'win') throw new Error(`${gameId}: corrected side did not cover`);
      return { key, before: pick, after: updated };
    });
    changes.forEach(({ before, after }) => console.log(`${before.gameId}: ${before.pick} (${before.result}) -> ${after.pick} (${after.result})`));
    if (dryRun) return console.log('Dry run; nothing written.');
    const transaction = client.multi();
    changes.forEach(({ key, after }) => transaction.set(key, JSON.stringify({
      ...after,
      correction: { previousPick: corrections.find(([id]) => id === after.gameId)[1], previousResult: 'loss', correctedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    })));
    await transaction.exec();
    console.log('Four corrections written.');
  } finally {
    await client.quit();
  }
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
