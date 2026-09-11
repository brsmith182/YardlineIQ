const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { sendNotificationEmail } = require('../lib/notify');

const ENV_KEYS = ['RESEND_API_KEY', 'RESEND_EMAIL_DOMAIN', 'NOTIFY_EMAIL'];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.RESEND_EMAIL_DOMAIN = 'yardlineiq.com';
  process.env.NOTIFY_EMAIL = 'owner@example.com';
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

test('sends a new signup to the owner through Resend', async (t) => {
  const fetchMock = resendAccepts(t);

  const sent = await sendNotificationEmail('signup', { email: 'fan@example.com' });

  assert.equal(sent, true);
  assert.equal(fetchMock.mock.callCount(), 1);
  const [url, init] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer re_test_key');
  assert.ok(init.signal instanceof AbortSignal, 'a hung request must be able to time out');

  const body = sentBody(fetchMock);
  assert.deepEqual(body.to, ['owner@example.com']);
  // Resend refuses to send from a domain that is not verified on the account.
  assert.match(body.from, /@yardlineiq\.com>?$/);
  assert.match(body.subject, /fan@example\.com/);
});

test('names the package, price and buyer in a sale alert', async (t) => {
  const fetchMock = resendAccepts(t);

  await sendNotificationEmail('payment', {
    name: 'Pat Doe',
    email: 'pat@example.com',
    packageType: 'weekly',
    packageLabel: 'Weekly Pass',
    amount: 29,
    source: 'webhook'
  });

  const body = sentBody(fetchMock);
  assert.match(body.subject, /Weekly Pass/);
  // A whole-dollar price still shows its cents.
  assert.match(body.subject, /\$29\.00/);
  assert.match(body.text, /Pat Doe/);
  assert.match(body.text, /pat@example\.com/);
});

for (const missing of ENV_KEYS) {
  test(`skips the send when ${missing} is not set`, async (t) => {
    delete process.env[missing];
    const fetchMock = resendAccepts(t);
    t.mock.method(console, 'warn', () => {});

    const sent = await sendNotificationEmail('signup', { email: 'fan@example.com' });

    assert.equal(sent, false);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
}

test('does not send an alert of an unknown type', async (t) => {
  const fetchMock = resendAccepts(t);
  t.mock.method(console, 'error', () => {});

  const sent = await sendNotificationEmail('sigup', { email: 'fan@example.com' });

  assert.equal(sent, false);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('reports a send Resend rejects instead of throwing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({
      statusCode: 403,
      name: 'validation_error',
      message: 'The yardlineiq.com domain is not verified.'
    }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  );
  t.mock.method(console, 'error', () => {});

  const sent = await sendNotificationEmail('signup', { email: 'fan@example.com' });

  assert.equal(sent, false);
});

test('reports a request that fails or times out instead of throwing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  });
  t.mock.method(console, 'error', () => {});

  const sent = await sendNotificationEmail('signup', { email: 'fan@example.com' });

  assert.equal(sent, false);
});
