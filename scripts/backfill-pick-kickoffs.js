#!/usr/bin/env node
/*
 * One-off: sets `kickoff` on pick records posted before it was stored.
 *
 *   node --env-file=.env.local scripts/backfill-pick-kickoffs.js [--dry-run]
 *
 * The picks archive orders past weeks by when the games were played, which it
 * reads from the pick rather than the board — the board only ever holds the
 * current week. Picks from earlier weeks therefore have to be told their own
 * kickoff once.
 *
 * The kickoffs come from the boards themselves, out of git history: every
 * UPCOMING_GAMES array this repo has ever committed is scanned and indexed by
 * game id, so a pick is matched to the very row it was posted against instead
 * of having its printed time re-parsed.
 *
 * --dry-run prints what would change and writes nothing.
 */

const { execFileSync } = require('child_process');
const { createClient } = require('redis');

// The board literal parses the same way post-pick.js reads it: as text, since
// requiring server.js would start the listener.
function parseBoard(src) {
  const start = src.indexOf('const UPCOMING_GAMES = [');
  const end = src.indexOf('\n];', start);
  if (start < 0 || end < 0) return [];
  const literal = src.slice(start + 'const UPCOMING_GAMES = '.length, end + 2);
  try {
    return JSON.parse(
      literal
        .replace(/\/\/[^\n]*/g, '')
        .replace(/([{,]\s*)([A-Za-z]\w*):/g, '$1"$2":')
        .replace(/'/g, '"')
        .replace(/,(\s*[}\]])/g, '$1')
    );
  } catch {
    return [];
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: __dirname + '/..', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// gameId -> kickoff, gathered from every commit that touched server.js. Later
// commits are read first and never overwritten, so if a kickoff was corrected
// the correction wins.
function kickoffsFromHistory() {
  const shas = git(['log', '--format=%H', '--', 'server.js']).split('\n').filter(Boolean);
  const byId = new Map();
  for (const sha of shas) {
    let src;
    try {
      src = git(['show', `${sha}:server.js`]);
    } catch {
      continue;
    }
    for (const g of parseBoard(src)) {
      if (g && g.id && g.kickoff && !byId.has(g.id)) byId.set(g.id, g.kickoff);
    }
  }
  return byId;
}

(async () => {
  const dryRun = process.argv.includes('--dry-run');

  const kickoffs = kickoffsFromHistory();
  console.log(`Found ${kickoffs.size} game kickoffs across the committed boards.\n`);

  if (!process.env.REDIS_URL) {
    console.error('REDIS_URL is not set — run with --env-file=.env.local');
    process.exit(1);
  }

  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (e) => console.error('Redis error:', e.message));
  await client.connect();

  const ids = (await client.sMembers('all_picks')).sort((a, b) => a - b);
  let updated = 0;
  let already = 0;
  const unmatched = [];

  for (const id of ids) {
    const data = await client.get(`pick:${id}`);
    if (!data) continue;
    const pick = JSON.parse(data);

    if (pick.kickoff) { already++; continue; }

    const kickoff = kickoffs.get(pick.gameId);
    if (!kickoff) {
      unmatched.push(`${id}  ${pick.gameId || '(no gameId)'}  ${pick.game}`);
      continue;
    }

    console.log(`${id}  ${pick.gameId}  ->  ${kickoff}`);
    if (!dryRun) {
      pick.kickoff = kickoff;
      await client.set(`pick:${id}`, JSON.stringify(pick));
    }
    updated++;
  }

  console.log(`\n${updated} to set, ${already} already had one, ${unmatched.length} unmatched.`);
  if (unmatched.length) {
    // Not a failure: these fall back to their printed time in the archive.
    console.log('\nNo board row found for:');
    unmatched.forEach((u) => console.log('  ' + u));
  }
  if (dryRun) console.log('\n--dry-run: nothing written.');

  await client.quit();
})().catch((e) => { console.error(e); process.exit(1); });
