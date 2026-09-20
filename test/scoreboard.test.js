const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeScoreboard, resolveLine } = require('../lib/scoreboard');

// A real capture of ESPN's scoreboard from the 2026 Week 2 Sunday slate,
// trimmed to the fields lib/scoreboard.js reads. It carries a game at halftime,
// a game mid-quarter, a final, and two that had not kicked off yet.
const espn = require('./fixtures/espn-scoreboard.json');

// The matching rows from UPCOMING_GAMES, verbatim. Spreads are signed from the
// home team's perspective, which is what makes these two interesting: Kansas
// City is laying at home, Seattle is laying on the road.
const BOARD = [
  {
    id: '2026-w2-ind-at-kc',
    kickoff: '2026-09-20T20:20:00-04:00',
    away: 'Indianapolis Colts',
    home: 'Kansas City Chiefs',
    spread: { open: -5.5, current: -6 },
  },
  {
    id: '2026-w2-sea-at-ari',
    kickoff: '2026-09-20T16:25:00-04:00',
    away: 'Seattle Seahawks',
    home: 'Arizona Cardinals',
    spread: { open: 10, current: 4 },
  },
];

const byId = (result, shortName) => {
  const event = espn.events.find((e) => e.shortName === shortName);
  return result.games.find((g) => g.id === event.id);
};

test('a game in progress keeps its score and clock', () => {
  const game = byId(normalizeScoreboard(espn, BOARD), 'CAR @ ATL');
  assert.equal(game.state, 'in');
  assert.equal(game.detail, 'Halftime');
  assert.equal(game.away.abbr, 'CAR');
  assert.equal(game.away.score, 20);
  assert.equal(game.home.abbr, 'ATL');
  assert.equal(game.home.score, 3);
  assert.equal(game.winner, null, 'nobody has won at halftime');
});

test('a mid-quarter game carries the clock through verbatim', () => {
  assert.equal(byId(normalizeScoreboard(espn, BOARD), 'MIN @ CHI').detail, '9:03 - 3rd');
});

test('a final marks the winning side', () => {
  const game = byId(normalizeScoreboard(espn, BOARD), 'DET @ BUF');
  assert.equal(game.state, 'post');
  assert.equal(game.detail, 'Final');
  assert.equal(game.away.score, 31);
  assert.equal(game.home.score, 41);
  assert.equal(game.winner, 'home');
});

test('a home favourite is shown laying the points', () => {
  const game = byId(normalizeScoreboard(espn, BOARD), 'IND @ KC');
  assert.equal(game.state, 'pre');
  assert.deepEqual(game.line, { team: 'KC', points: -6 });
});

test('an away favourite flips which team is laying', () => {
  // The board has this at +4 from Arizona's perspective, so Seattle lays 4 —
  // not "ARI +4", which is the same number pointed the wrong way.
  const game = byId(normalizeScoreboard(espn, BOARD), 'SEA @ ARI');
  assert.deepEqual(game.line, { team: 'SEA', points: -4 });
});

test('kickoff comes from the board, not ESPN, when the game is on it', () => {
  const game = byId(normalizeScoreboard(espn, BOARD), 'IND @ KC');
  assert.equal(game.kickoff, '2026-09-20T20:20:00-04:00');
});

test('a game missing from the board still renders, just without a line', () => {
  const game = byId(normalizeScoreboard(espn, []), 'IND @ KC');
  assert.ok(game, 'the game should still be in the payload');
  assert.equal(game.line, null);
  assert.equal(game.kickoff, espn.events.find((e) => e.shortName === 'IND @ KC').date);
});

test('a game that has started shows no line even when the board has one', () => {
  // Once there is a score to read, the pre-game number is noise.
  assert.equal(byId(normalizeScoreboard(espn, BOARD), 'CAR @ ATL').line, null);
});

test('season and week come through for the strip label', () => {
  const result = normalizeScoreboard(espn, BOARD);
  assert.equal(result.season, 2026);
  assert.equal(result.week, 2);
});

test('logos come straight from the feed', () => {
  const game = byId(normalizeScoreboard(espn, BOARD), 'CAR @ ATL');
  assert.match(game.away.logo, /^https:\/\/a\.espncdn\.com\//);
});

test("ESPN's JAX joins the board's Jacksonville", () => {
  // nfl-teams.js maps the Jaguars to jac; ESPN's scoreboard says JAX. Without
  // the alias this game would silently lose its line.
  const feed = {
    events: [{
      id: '1', date: '2026-09-20T20:20Z',
      status: { type: { state: 'pre', shortDetail: '8:20 PM EDT' } },
      competitions: [{ competitors: [
        { homeAway: 'away', score: '0', team: { abbreviation: 'JAX', displayName: 'Jacksonville Jaguars' } },
        { homeAway: 'home', score: '0', team: { abbreviation: 'DEN', displayName: 'Denver Broncos' } },
      ] }],
    }],
  };
  const board = [{ away: 'Jacksonville Jaguars', home: 'Denver Broncos', spread: { current: -2.5 } }];
  assert.deepEqual(normalizeScoreboard(feed, board).games[0].line, { team: 'DEN', points: -2.5 });
});

test('a pick\'em has no favourite', () => {
  assert.deepEqual(resolveLine(0, 'CAR', 'ATL'), { team: null, points: 0 });
});

test('a missing or unusable spread produces no line at all', () => {
  assert.equal(resolveLine(undefined, 'CAR', 'ATL'), null);
  assert.equal(resolveLine(null, 'CAR', 'ATL'), null);
  assert.equal(resolveLine(NaN, 'CAR', 'ATL'), null);
  assert.equal(resolveLine('-3', 'CAR', 'ATL'), null);
});

test('malformed input yields an empty slate instead of throwing', () => {
  for (const junk of [null, undefined, {}, { events: null }, { events: 'nope' }, 'string']) {
    assert.deepEqual(normalizeScoreboard(junk, BOARD).games, [], `failed on ${JSON.stringify(junk)}`);
  }
});

test('an event with no competitors is skipped rather than half-rendered', () => {
  const feed = { events: [{ id: '1', competitions: [{ competitors: [] }] }, ...espn.events] };
  const result = normalizeScoreboard(feed, BOARD);
  assert.equal(result.games.length, espn.events.length);
  assert.ok(result.games.every((g) => g.away.abbr && g.home.abbr));
});
