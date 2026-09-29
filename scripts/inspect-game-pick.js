#!/usr/bin/env node
const { createClient } = require('redis');

async function main() {
  const gameId = process.argv[2];
  if (!gameId || !process.env.REDIS_URL) throw new Error('Game ID and REDIS_URL are required');
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  try {
    const ids = await client.sMembers('all_picks');
    const records = await Promise.all(ids.map((id) => client.get(`pick:${id}`)));
    console.log(JSON.stringify(records.filter(Boolean).map(JSON.parse).filter((pick) => pick.gameId === gameId), null, 2));
  } finally {
    await client.quit();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
