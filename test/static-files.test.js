const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const { publicStatic } = require('../lib/static-files');

// Two deployments of the same page, the way the 8–6 -> 8–7 season record
// update shipped: same length, and the same fixed mtime Vercel gives every file.
const FROZEN_MTIME = new Date('2018-10-20T01:46:40Z');
let root;
let deploys;

function deploy(name, html) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, html);
  fs.utimesSync(file, FROZEN_MTIME, FROZEN_MTIME);
  return dir;
}

// Plain http rather than fetch: fetch adds Cache-Control: no-cache to any
// request carrying If-None-Match, which forces a 200 and hides the bug.
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

async function serve(dir, fn) {
  const app = express();
  app.use(publicStatic(dir));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// What a browser sends back when revalidating a page it has cached.
function revalidationHeaders(res) {
  const headers = {};
  if (res.headers.etag) headers['If-None-Match'] = res.headers.etag;
  if (res.headers['last-modified']) headers['If-Modified-Since'] = res.headers['last-modified'];
  return headers;
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'yiq-static-'));
  deploys = {
    old: deploy('old', '<p>8–6 · 14 picks</p>'),
    next: deploy('next', '<p>8–7 · 15 picks</p>'),
  };
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('a returning browser gets the new page when an edit keeps its length', async () => {
  const cached = await serve(deploys.old, (base) => get(base + '/'));

  await serve(deploys.next, async (base) => {
    const res = await get(base + '/', revalidationHeaders(cached));
    assert.equal(res.status, 200);
    assert.match(res.body, /8–7/);
  });
});

test('an unchanged page still revalidates as 304', async () => {
  await serve(deploys.next, async (base) => {
    const first = await get(base + '/');
    assert.ok(first.headers.etag, 'expected an ETag');

    const again = await get(base + '/', revalidationHeaders(first));
    assert.equal(again.status, 304);
  });
});

test('extensionless paths still resolve to their .html file', async () => {
  fs.writeFileSync(path.join(deploys.next, 'picks.html'), '<p>picks</p>');
  await serve(deploys.next, async (base) => {
    const res = await get(base + '/picks');
    assert.equal(res.status, 200);
    assert.match(res.body, /picks/);
  });
});
