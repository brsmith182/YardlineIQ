const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  pickKickoffMs,
  byKickoff,
  latestKickoffMs,
  weekRecord,
  tierRecord,
} = require('../public/js/odds-format.js');

// A pick as the archive actually receives it, trimmed to the fields the
// ordering and the record care about.
const pick = (over) => Object.assign({
  id: '1789308037444',
  week: '1',
  game: 'New England Patriots vs Seattle Seahawks',
  result: 'win',
}, over);

test('reads the kickoff off the pick when it has one', () => {
  const ms = pickKickoffMs(pick({ kickoff: '2026-09-09T20:20:00-04:00' }));
  assert.equal(ms, Date.parse('2026-09-09T20:20:00-04:00'));
});

test('falls back to the printed time when there is no kickoff', () => {
  // Picks posted before kickoff was stored carry only the formatted string.
  const a = pickKickoffMs(pick({ time: 'September 9, 2026 · 8:20 PM ET' }));
  const b = pickKickoffMs(pick({ time: 'September 14, 2026 · 8:15 PM ET' }));
  assert.ok(a != null && b != null, 'both times should parse');
  assert.ok(a < b, 'the earlier date should sort first');
});

test('an unknown kickoff is null rather than a guess', () => {
  assert.equal(pickKickoffMs(pick({})), null);
  assert.equal(pickKickoffMs(pick({ time: 'sometime Sunday' })), null);
});

test('orders a week by when the games were played, earliest first', () => {
  const picks = [
    pick({ id: '3', kickoff: '2026-09-14T20:15:00-04:00' }), // Monday night
    pick({ id: '1', kickoff: '2026-09-09T20:20:00-04:00' }), // Wednesday opener
    pick({ id: '2', kickoff: '2026-09-13T13:00:00-04:00' }), // Sunday early
  ];
  assert.deepEqual(picks.sort(byKickoff).map((p) => p.id), ['1', '2', '3']);
});

test('picks with no kickoff sort to the end instead of to 1970', () => {
  const picks = [
    pick({ id: 'unknown' }),
    pick({ id: 'known', kickoff: '2026-09-13T13:00:00-04:00' }),
  ];
  assert.deepEqual(picks.sort(byKickoff).map((p) => p.id), ['known', 'unknown']);
});

test('a week is dated by its last game, so weeks can be ordered newest first', () => {
  const week1 = [
    pick({ kickoff: '2026-09-09T20:20:00-04:00' }),
    pick({ kickoff: '2026-09-14T20:15:00-04:00' }),
  ];
  const week2 = [pick({ kickoff: '2026-09-17T20:15:00-04:00' })];
  assert.ok(latestKickoffMs(week2) > latestKickoffMs(week1));
});

test('a week with nothing to date it sorts last rather than first', () => {
  assert.equal(latestKickoffMs([pick({})]), null);
});

test('counts the week ATS record', () => {
  const picks = [
    pick({ result: 'win' }), pick({ result: 'win' }), pick({ result: 'loss' }),
  ];
  assert.equal(weekRecord(picks), '2-1');
});

test('shows pushes only when there are some', () => {
  assert.equal(weekRecord([pick({ result: 'win' }), pick({ result: 'push' })]), '1-0-1');
  assert.equal(weekRecord([pick({ result: 'win' })]), '1-0');
});

test('ungraded picks are left out of the record', () => {
  const picks = [pick({ result: 'win' }), pick({ result: 'pending' }), pick({ result: '' })];
  assert.equal(weekRecord(picks), '1-0');
});

test('a week with nothing graded yet has no record to show', () => {
  assert.equal(weekRecord([pick({ result: 'pending' })]), '');
  assert.equal(weekRecord([]), '');
});

test('grades are read whatever case they are stored in', () => {
  assert.equal(weekRecord([pick({ result: 'Win' }), pick({ result: 'LOSS' })]), '1-1');
});

test('counts a tier record from only that tier\'s picks', () => {
  const picks = [
    pick({ result: 'win', tier: 'vip' }),
    pick({ result: 'loss', tier: 'VIP' }),
    pick({ result: 'win', tier: 'free' }),
    pick({ result: 'loss' }),
  ];
  assert.equal(tierRecord(picks, 'vip'), '1-1');
  assert.equal(tierRecord(picks, 'free'), '1-0');
});

test('a tier with no graded picks that week has no record to show', () => {
  const picks = [pick({ result: 'win' }), pick({ result: 'pending', tier: 'free' })];
  assert.equal(tierRecord(picks, 'vip'), '');
  assert.equal(tierRecord(picks, 'free'), '');
});
