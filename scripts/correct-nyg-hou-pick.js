#!/usr/bin/env node
// Correct the posted Week 7 NYG/HOU side without creating a duplicate pick.
const { createClient } = require('redis');

async function main() {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required');
  const client = createClient({ url: process.env.REDIS_URL,
    socket: { connectTimeout: 10000, reconnectStrategy: false } });
  client.on('error', () => {});
  await client.connect();
  const key = 'pick:1792905822356';
  try {
    await client.watch(key);
    const raw = await client.get(key);
    if (!raw) throw new Error('Expected NYG/HOU pick is missing');
    const pick = JSON.parse(raw);
    if (pick.gameId !== '2026-w7-nyg-at-hou' ||
        pick.pick !== 'Houston Texans -10.5' || pick.result !== 'pending') {
      throw new Error('Stored game, pick, or result changed; nothing written');
    }
    const now = new Date().toISOString();
    const updated = {
      ...pick,
      pick: 'New York Giants +10.5',
      correction: { previousPick: pick.pick, correctedAt: now },
      updatedAt: now,
    };
    console.log(`${pick.gameId}: ${pick.pick} -> ${updated.pick}`);
    if (process.argv.includes('--dry-run')) return;
    await client.multi().set(key, JSON.stringify(updated)).exec();
    const saved = JSON.parse(await client.get(key));
    if (saved.pick !== updated.pick) throw new Error('Read-back verification failed');
    console.log(`Verified saved pick: ${saved.pick} (${saved.result})`);
  } finally {
    await client.quit();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
