#!/usr/bin/env node
/*
 * Posts a pick straight to Redis, the same shape POST /api/picks writes:
 *
 *   node --env-file=.env.local scripts/post-pick.js <gameId> "<Team ±line>" [--dry-run]
 *
 * gameId is the board row the pick is made against (2026-w2-det-at-buf), and
 * the week, game name and kickoff are read off that row rather than typed in,
 * so the pick can never disagree with the board it renders on.
 *
 * Optional: --confidence High|Medium|Low, --tier vip|free, --reasoning "...".
 * Left off, the card renders without those badges.
 *
 * --dry-run prints the record and writes nothing.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('redis');

// The board is read out of server.js as text, not required: requiring it would
// start the listener. Same reason grade-pick.js never imports it either.
function loadBoard() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = src.indexOf('const UPCOMING_GAMES = [');
  const end = src.indexOf('\n];', start);
  if (start < 0 || end < 0) throw new Error('UPCOMING_GAMES not found in server.js');
  const literal = src.slice(start + 'const UPCOMING_GAMES = '.length, end + 2);
  return JSON.parse(
    literal
      .replace(/\/\/[^\n]*/g, '')          // strip line comments
      .replace(/([{,]\s*)([A-Za-z]\w*):/g, '$1"$2":')  // quote keys
      .replace(/'/g, '"')                   // single -> double quotes
      .replace(/,(\s*[}\]])/g, '$1')        // drop trailing commas
  );
}

const UPCOMING_GAMES = loadBoard();

function flag(name) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : '';
}

// "September 17, 2026 · 8:15 PM ET", matching the picks already in the store.
function fmtKickoff(iso) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return `${get('month')} ${get('day')}, ${get('year')} · `
    + `${get('hour')}:${get('minute')} ${get('dayPeriod')} ET`;
}

(async () => {
  const [gameId, pickText] = process.argv.slice(2);
  if (!gameId || !pickText || pickText.startsWith('--')) {
    console.error('usage: node --env-file=.env.local scripts/post-pick.js <gameId> "<Team ±line>" [--dry-run]');
    process.exit(1);
  }

  const game = UPCOMING_GAMES.find((g) => g.id === gameId);
  if (!game) {
    console.error(`No game "${gameId}" on the board. Ids currently posted:`);
    UPCOMING_GAMES.forEach((g) => console.error('  ' + g.id));
    process.exit(1);
  }

  // The pick has to name a team that is actually in this game, or it would
  // render on a card it contradicts.
  const named = [game.away, game.home].find((t) => pickText.startsWith(t));
  if (!named) {
    console.error(`Pick "${pickText}" names neither ${game.away} nor ${game.home}.`);
    process.exit(1);
  }

  const pick = {
    id: Date.now().toString(),
    week: String(game.week),
    game: `${game.away} vs ${game.home}`,
    gameId: game.id,
    // Stored as well as printed: the archive orders past picks by kickoff,
    // and the board that knows it is replaced every week.
    kickoff: game.kickoff,
    time: fmtKickoff(game.kickoff),
    pick: pickText.trim(),
    confidence: flag('confidence'),
    reasoning: flag('reasoning'),
    datePosted: new Date().toISOString(),
    result: 'pending',
  };
  const tier = flag('tier');
  if (tier) pick.tier = tier.toLowerCase();

  console.log(JSON.stringify(pick, null, 2));

  if (process.argv.includes('--dry-run')) {
    console.log('\n--dry-run: nothing written.');
    return;
  }

  if (!process.env.REDIS_URL) {
    console.error('REDIS_URL is not set — run with --env-file=.env.local');
    process.exit(1);
  }

  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (e) => console.error('Redis error:', e.message));
  await client.connect();

  // A second pick on the same game would render over the first one, so say so
  // rather than quietly stacking them.
  const existing = await client.sMembers('all_picks');
  for (const id of existing) {
    const data = await client.get(`pick:${id}`);
    if (data && JSON.parse(data).gameId === game.id) {
      console.error(`\nPick ${id} is already posted on ${game.id}. Refusing to stack a second one.`);
      await client.quit();
      process.exit(1);
    }
  }

  await client.set(`pick:${pick.id}`, JSON.stringify(pick));
  await client.sAdd('all_picks', pick.id);

  console.log(`\nPosted pick ${pick.id} on ${game.id}.`);
  await client.quit();
})().catch((e) => { console.error(e); process.exit(1); });
