#!/usr/bin/env node
// Correct the posted Week 3 PHI/CHI side without creating a duplicate pick.
const { createClient } = require('redis');

async function main() {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required');
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  try {
    const ids = await client.sMembers('all_picks');
    const rows = (await Promise.all(ids.map(async (id) => {
      const raw = await client.get(`pick:${id}`);
      return raw ? { key: `pick:${id}`, pick: JSON.parse(raw) } : null;
    }))).filter(Boolean).filter(({ pick }) => pick.gameId === '2026-w3-phi-at-chi');
    if (rows.length !== 1) throw new Error(`Expected one PHI/CHI pick, found ${rows.length}`);
    const { key, pick } = rows[0];
    if (pick.pick !== 'Philadelphia Eagles -3.5' || pick.result !== 'pending') {
      throw new Error(`Pick changed: ${pick.pick} (${pick.result}); nothing written`);
    }
    const updated = {
      ...pick,
      pick: 'Chicago Bears +3.5',
      correction: {
        previousPick: pick.pick,
        correctedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
    console.log(`${key}: ${pick.pick} -> ${updated.pick}`);
    if (process.argv.includes('--dry-run')) return;
    await client.set(key, JSON.stringify(updated));
    console.log('Correction written.');
  } finally {
    await client.quit();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
