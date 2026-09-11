const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gradePick } = require('../scripts/grade-pick');

const neAtSea = { game: 'New England Patriots vs Seattle Seahawks' };
const sfAtLar = { game: 'San Francisco 49ers vs Los Angeles Rams' };

test('an underdog that loses by less than the spread covers', () => {
  const pick = { ...neAtSea, pick: 'New England Patriots +3.5' };
  assert.equal(gradePick(pick, { away: 10, home: 13 }), 'win');
});

test('an underdog that wins outright covers', () => {
  const pick = { ...sfAtLar, pick: 'San Francisco 49ers +3.5' };
  assert.equal(gradePick(pick, { away: 27, home: 7 }), 'win');
});

test('a favorite that wins by less than the spread does not cover', () => {
  const pick = { ...neAtSea, pick: 'Seattle Seahawks -3.5' };
  assert.equal(gradePick(pick, { away: 10, home: 13 }), 'loss');
});

test('landing exactly on a whole-number spread is a push', () => {
  const pick = { ...neAtSea, pick: 'Seattle Seahawks -3' };
  assert.equal(gradePick(pick, { away: 10, home: 13 }), 'push');
});

test("a pick'em is graded on the straight-up result", () => {
  assert.equal(gradePick({ ...neAtSea, pick: 'New England Patriots PK' }, { away: 10, home: 13 }), 'loss');
  assert.equal(gradePick({ ...neAtSea, pick: 'Seattle Seahawks pk' }, { away: 10, home: 13 }), 'win');
});

test('refuses a pick line with no spread on it', () => {
  const pick = { ...neAtSea, pick: 'New England Patriots' };
  assert.throws(() => gradePick(pick, { away: 10, home: 13 }), /spread/);
});

test('refuses a pick on a team that is not in the game', () => {
  const pick = { ...neAtSea, pick: 'Dallas Cowboys +3.5' };
  assert.throws(() => gradePick(pick, { away: 10, home: 13 }), /not in/);
});
