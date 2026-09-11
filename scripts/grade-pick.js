#!/usr/bin/env node
/*
 * Grades a published pick against its game's final score and stores both on
 * the pick record:
 *
 *   node --env-file=.env.local scripts/grade-pick.js <gameId> <awayScore> <homeScore> [--dry-run]
 *
 * gameId is the board id the pick was posted against (2026-w1-ne-at-sea), and
 * the scores go in the same away-then-home order the id reads in.
 *
 * The grade is worked out from the pick's own line rather than typed in, so a
 * pick can never be marked covered when the score says it didn't. The score is
 * kept on the pick as `finalScore: { away, home }` rather than on the board,
 * because the board is replaced every week and the graded pick outlives it in
 * the archive.
 *
 * --dry-run prints the grade and writes nothing.
 */

const { createClient } = require('redis');

// "Away Team vs Home Team", split the same way as parseTeams in
// public/js/nfl-teams.js, so the script and the page agree on which is which.
function splitGame(game) {
  const parts = String(game || '').split(/\s+vs\.?\s+/i);
  if (parts.length !== 2) return null;
  return { away: parts[0].trim(), home: parts[1].trim() };
}

// "New England Patriots +3.5" -> { team: 'New England Patriots', line: 3.5 }.
// PK is a zero line.
function parseLine(pickText) {
  const m = String(pickText || '').trim().match(/^(.+?)\s+(pk|[+-]?\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  return { team: m[1].trim(), line: /^pk$/i.test(m[2]) ? 0 : Number(m[2]) };
}

// The picked side covers when its margin plus the line is positive; landing
// exactly on the number is a push.
function gradePick(pick, score) {
  const teams = splitGame(pick.game);
  if (!teams) throw new Error(`can't read away/home from game "${pick.game}"`);
  const parsed = parseLine(pick.pick);
  if (!parsed) throw new Error(`can't read a team and spread from pick "${pick.pick}"`);

  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  let margin;
  if (same(parsed.team, teams.away)) margin = score.away - score.home;
  else if (same(parsed.team, teams.home)) margin = score.home - score.away;
  else throw new Error(`picked team "${parsed.team}" is not in "${pick.game}"`);

  const cover = margin + parsed.line;
  return cover > 0 ? 'win' : cover < 0 ? 'loss' : 'push';
}

const USAGE = 'usage: node --env-file=.env.local scripts/grade-pick.js <gameId> <awayScore> <homeScore> [--dry-run]';

const parseScore = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);

async function main(argv) {
  const args = argv.filter((a) => a !== '--dry-run');
  const dryRun = args.length !== argv.length;
  const [gameId, away, home] = [args[0], parseScore(args[1]), parseScore(args[2])];
  if (args.length !== 3 || !gameId || away == null || home == null) {
    console.error(USAGE);
    process.exit(1);
  }
  if (!process.env.REDIS_URL) {
    console.error('REDIS_URL is not set. Run with --env-file=.env.local');
    process.exit(1);
  }

  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (e) => console.error('Redis error:', e.message));
  await client.connect();

  try {
    // Newest first, so if a game somehow has two picks the one graded is the
    // one /api/games shows on the board.
    const ids = (await client.sMembers('all_picks')).sort((a, b) => b - a);
    let key = null;
    let pick = null;
    for (const id of ids) {
      const raw = await client.get(`pick:${id}`);
      if (!raw) continue;
      const p = JSON.parse(raw);
      if (p.gameId === gameId) {
        key = `pick:${id}`;
        pick = p;
        break;
      }
    }
    if (!pick) {
      console.error(`No pick found with gameId ${gameId}`);
      process.exitCode = 1;
      return;
    }

    const finalScore = { away, home };
    const result = gradePick(pick, finalScore);
    const teams = splitGame(pick.game);
    console.log(`${pick.pick}: final ${teams.away} ${away}, ${teams.home} ${home} -> ${result}`);

    if (dryRun) {
      console.log('Dry run, nothing written.');
      return;
    }

    console.log('Before:', JSON.stringify(pick));
    const updated = { ...pick, result, finalScore, updatedAt: new Date().toISOString() };
    await client.set(key, JSON.stringify(updated));
    console.log('After: ', await client.get(key));
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

module.exports = { gradePick };
