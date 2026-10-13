const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { sendFreePickConfirmation } = require('../lib/free-pick-email');

const ENV_KEYS = ['RESEND_API_KEY', 'RESEND_EMAIL_DOMAIN'];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.RESEND_EMAIL_DOMAIN = 'yardlineiq.com';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

// Resend answers a successful send with 200 and the new email's id.
function resendAccepts(t) {
  return t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  );
}

function sentBody(fetchMock) {
  assert.equal(fetchMock.mock.callCount(), 1, 'expected exactly one request to Resend');
  return JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
}

test('sends the confirmation to the requester from the picks address', async (t) => {
  const fetchMock = resendAccepts(t);

  const sent = await sendFreePickConfirmation('fan@example.com');

  assert.equal(sent, true);
  const body = sentBody(fetchMock);
  assert.deepEqual(body.to, ['fan@example.com']);
  assert.equal(body.from, 'YardlineIQ <picks@yardlineiq.com>');
  assert.equal(body.subject, 'Your free YardlineIQ pick is on the way');
});

test('names the requester\'s address in both the text and HTML versions', async (t) => {
  const fetchMock = resendAccepts(t);

  await sendFreePickConfirmation('fan@example.com');

  const body = sentBody(fetchMock);
  assert.match(body.text, /We've saved fan@example\.com for this week's free pick/);
  assert.match(body.html, /fan@example\.com/);
});

test('tells the requester which address to add to their contacts', async (t) => {
  const fetchMock = resendAccepts(t);

  await sendFreePickConfirmation('fan@example.com');

  const body = sentBody(fetchMock);
  assert.match(body.text, /add picks@yardlineiq\.com to your contacts/);
  assert.match(body.html, /picks@yardlineiq\.com/);
});

test('links to the season record on the homepage', async (t) => {
  const fetchMock = resendAccepts(t);

  await sendFreePickConfirmation('fan@example.com');

  const body = sentBody(fetchMock);
  assert.match(body.text, /https:\/\/www\.yardlineiq\.com\//);
  assert.match(body.html, /href="https:\/\/www\.yardlineiq\.com\/"/);
});

test('carries the entertainment-only and responsible gambling notice', async (t) => {
  const fetchMock = resendAccepts(t);

  await sendFreePickConfirmation('fan@example.com');

  const body = sentBody(fetchMock);
  for (const version of [body.text, body.html]) {
    assert.match(version, /entertainment purposes only/);
    assert.match(version, /21 or older/);
    assert.match(version, /1-800-GAMBLER/);
    assert.match(version, /If that wasn't you, you can ignore this message/);
  }
});

test('escapes the address before putting it in the HTML', async (t) => {
  const fetchMock = resendAccepts(t);

  // `&` and `'` are legal in the local part of a real address.
  await sendFreePickConfirmation("tom&o'neil@example.com");

  const body = sentBody(fetchMock);
  assert.match(body.html, /tom&amp;o&#39;neil@example\.com/);
  assert.doesNotMatch(body.html, /tom&o'neil/);
});

// The signup route only checks for an `@`, and anyone can submit the form, so
// the confirmation must never become a way to mail several people at once or
// to slip markup into the message.
for (const address of [
  'fan@example.com, victim@example.com',
  'fan@example.com;victim@example.com',
  'Fan <fan@example.com>',
  'fan@example',
  'fan@@example.com',
  'fan @example.com',
  `${'a'.repeat(250)}@example.com`
]) {
  test(`does not send to ${JSON.stringify(address.slice(0, 40))}`, async (t) => {
    const fetchMock = resendAccepts(t);
    t.mock.method(console, 'warn', () => {});

    const sent = await sendFreePickConfirmation(address);

    assert.equal(sent, false);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
}

test('skips the send when Resend is not configured', async (t) => {
  delete process.env.RESEND_API_KEY;
  const fetchMock = resendAccepts(t);
  t.mock.method(console, 'warn', () => {});

  const sent = await sendFreePickConfirmation('fan@example.com');

  assert.equal(sent, false);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('reports a send Resend rejects instead of throwing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ statusCode: 422, name: 'validation_error' }), { status: 422 })
  );
  t.mock.method(console, 'error', () => {});

  const sent = await sendFreePickConfirmation('fan@example.com');

  assert.equal(sent, false);
});
