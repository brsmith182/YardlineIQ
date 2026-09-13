#!/usr/bin/env node
/*
 * Marks published picks as VIP or the free pick, stored on the pick record:
 *
 *   node --env-file=.env.local scripts/set-pick-tier.js <vip|free|none> <gameId>... [--dry-run]
 *
 * gameId is the board id the pick was posted against (2026-w1-chi-at-car).
 * `none` clears the tier, leaving the pick in the full-season record only.
 *
 * The tier lives on the pick as `tier: 'vip' | 'free'` rather than on the
 * board for the same reason the grade does: the board is replaced every week
 * and the pick outlives it in the archive, where the tier record is counted.
 *
 * Every gameId is looked up before anything is written, so a typo in one id
 * leaves all of them untouched. --dry-run prints the changes and writes nothing.
 */

const { createClient } = require('redis');

const TIERS = ['vip', 'free'];

// 'VIP' -> 'vip', 'none' -> null. Anything else is refused rather than stored.
function normalizeTier(value) {
  const t = String(value || '').trim().toLowerCase();
  if (t === 'none') return null;
  if (TIERS.includes(t)) return t;
  throw new Error(`tier must be one of: ${[...TIERS, 'none'].join(', ')}`);
}

const USAGE = 'usage: node --env-file=.env.local scripts/set-pick-tier.js <vip|free|none> <gameId>... [--dry-run]';

async function main(argv) {
  const args = argv.filter((a) => a !== '--dry-run');
  const dryRun = args.length !== argv.length;
  const [tierArg, ...gameIds] = args;
  if (!tierArg || gameIds.length === 0) {
    console.error(USAGE);
    process.exit(1);
  }
  const tier = normalizeTier(tierArg);
  if (!process.env.REDIS_URL) {
    console.error('REDIS_URL is not set. Run with --env-file=.env.local');
    process.exit(1);
  }

  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (e) => console.error('Redis error:', e.message));
  await client.connect();

  try {
    // Newest first, so if a game somehow has two picks the one tagged is the
    // one /api/games shows on the board.
    const byGame = new Map();
    const ids = (await client.sMembers('all_picks')).sort((a, b) => b - a);
    for (const id of ids) {
      const raw = await client.get(`pick:${id}`);
      if (!raw) continue;
      const p = JSON.parse(raw);
      if (p.gameId && !byGame.has(p.gameId)) byGame.set(p.gameId, { key: `pick:${id}`, pick: p });
    }

    const missing = gameIds.filter((g) => !byGame.has(g));
    if (missing.length) {
      console.error(`No pick found with gameId ${missing.join(', ')}. Nothing written.`);
      process.exitCode = 1;
      return;
    }

    for (const gameId of gameIds) {
      const { key, pick } = byGame.get(gameId);
      console.log(`${pick.pick}: ${pick.tier || 'none'} -> ${tier || 'none'}`);
      if (dryRun) continue;

      const updated = { ...pick, updatedAt: new Date().toISOString() };
      if (tier) updated.tier = tier;
      else delete updated.tier;
      await client.set(key, JSON.stringify(updated));
    }

    if (dryRun) console.log('Dry run, nothing written.');
  } finally {
    await client.quit();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { normalizeTier };
