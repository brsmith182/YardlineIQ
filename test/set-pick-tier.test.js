const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTier } = require('../scripts/set-pick-tier');

test('accepts vip and free in any case', () => {
  assert.equal(normalizeTier('VIP'), 'vip');
  assert.equal(normalizeTier(' free '), 'free');
});

test('none clears the tier', () => {
  assert.equal(normalizeTier('none'), null);
});

test('refuses a tier that is not on the list', () => {
  assert.throws(() => normalizeTier('premium'), /tier must be/);
  assert.throws(() => normalizeTier(''), /tier must be/);
});
