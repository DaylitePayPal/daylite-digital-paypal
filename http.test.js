'use strict';

/**
 * HTTP-layer tests for the real Express app (server.js).
 *
 * They start createApp() on an ephemeral port and talk to it over real HTTP with
 * fetch. PayPal and Gemini are still replaced by in-process fake `fetch`
 * implementations, so no credentials or outbound network are needed. These tests
 * therefore verify Express wiring, middleware and routes, NOT the live PayPal
 * Sandbox or the live Gemini API.
 *
 * They require Express (`npm install`). If it is not installed they are reported as
 * skipped, never as passed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

let createApp = null;
let skipReason = false;
try {
  require.resolve('express');
  ({ createApp } = require('../server'));
} catch (err) {
  skipReason = 'express is not installed (run `npm install`)';
}

const catalog = require('../src/catalog');
const { createService } = require('../src/service');
const { createPayPalClient } = require('../src/paypal');

const SECRETS = ['SUPER-SECRET-PAYPAL', 'GEMINI-SECRET-KEY', 'fake-paypal-access-token'];

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** One fake backend for both PayPal Sandbox and Gemini. */
function makeBackends({ geminiReply, geminiStatus = 200, tamperAmount = false } = {}) {
  const calls = { create: [], capture: 0, gemini: [] };
  const orders = new Map();
  let n = 0;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'generativelanguage.googleapis.com') {
      calls.gemini.push(JSON.parse(init.body));
      if (geminiStatus !== 200) return jsonResponse(geminiStatus, { error: { message: 'upstream detail GEMINI-SECRET-KEY' } });
      const reply = geminiReply || { recommendations: [] };
      return jsonResponse(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] });
    }
    if (u.pathname === '/v1/oauth2/token') return jsonResponse(200, { access_token: 'fake-paypal-access-token', expires_in: 3600 });
    if (u.pathname === '/v2/checkout/orders' && init.method === 'POST') {
      const body = JSON.parse(init.body);
      n += 1;
      const id = `HTTPORDER-${n}0000`;
      orders.set(id, body);
      calls.create.push(body);
      return jsonResponse(201, { id, status: 'CREATED' });
    }
    const m = u.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/);
    if (m) {
      calls.capture += 1;
      const id = decodeURIComponent(m[1]);
      const unit = orders.get(id).purchase_units[0];
      return jsonResponse(201, {
        id,
        status: 'COMPLETED',
        purchase_units: [
          {
            reference_id: unit.reference_id,
            payments: {
              captures: [
                {
                  id: 'HTTPCAPTURE-1',
                  status: 'COMPLETED',
                  amount: { currency_code: unit.amount.currency_code, value: tamperAmount ? '0.01' : unit.amount.value },
                  custom_id: unit.custom_id,
                },
              ],
            },
          },
        ],
      });
    }
    return jsonResponse(404, {});
  };
  return { fetchImpl, calls };
}

/** Start the real app on an ephemeral port and run `fn(baseUrl)`; always shuts down. */
async function withServer(options, fn) {
  const backends = makeBackends(options.backends);
  const service = createService({
    paypalClient: createPayPalClient({ clientId: 'public-client-id', clientSecret: 'SUPER-SECRET-PAYPAL', fetchImpl: backends.fetchImpl }),
    gemini: { apiKey: 'GEMINI-SECRET-KEY', model: 'test-model', fetchImpl: backends.fetchImpl },
  });
  const app = createApp({ service, paypalClientId: 'public-client-id', aiLimit: options.aiLimit, checkoutLimit: options.checkoutLimit });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, backends);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function post(base, path, body, { raw } = {}) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
  return { res, text, json };
}

function assertNoSecrets(text, label) {
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `${label} must not contain ${secret}`);
}

const opts = { skip: skipReason };

test('HTTP: health, config and static files are served with security headers and no secrets', opts, async () => {
  await withServer({}, async (base) => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const cfg = await fetch(`${base}/api/config`);
    const cfgText = await cfg.text();
    const cfgJson = JSON.parse(cfgText);
    assert.equal(cfgJson.paypalClientId, 'public-client-id'); // public Client ID only
    assert.equal(cfgJson.paypalConfigured, true);
    assert.equal(cfgJson.aiConfigured, true);
    assert.equal(cfgJson.currency, 'USD');
    assertNoSecrets(cfgText, '/api/config');

    for (const [path, type] of [['/', 'text/html'], ['/app.js', 'javascript'], ['/styles.css', 'text/css']]) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200, path);
      assert.ok((res.headers.get('content-type') || '').includes(type), path);
      assertNoSecrets(await res.text(), path);
    }

    const home = await fetch(`${base}/`);
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.equal(home.headers.get('x-powered-by'), null);
    const csp = home.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'self'/);
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
    assert.match(csp, /frame-ancestors 'none'/);
  });
});

test('HTTP: catalogue endpoint lists the demonstration catalogue with server prices only', opts, async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/catalog`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.demonstration, true);
    assert.deepEqual(body.experiences.map((e) => e.id).sort(), catalog.listIds().sort());
    for (const id of ['new-york-city-icons', 'paris-art-and-cafes', 'luderitz-bucht-coast', 'sossusvlei-dunes']) {
      assert.ok(body.experiences.some((e) => e.id === id), id);
    }
    for (const e of body.experiences) {
      assert.equal(e.currency, 'USD');
      assert.equal(e.demonstration, true);
      assert.equal(e.pricePerTraveller, catalog.formatCents(catalog.getExperience(e.id).priceCents));
    }
  });
});

test('HTTP: AI recommendation is validated against the catalogue; invalid requests and bad AI output fail safely', opts, async () => {
  await withServer(
    {
      backends: {
        geminiReply: {
          recommendations: [
            { experienceId: 'atlantis-spa', reason: 'Invented place.', price: '1.00' },
            { experienceId: 'luderitz-bucht-coast', reason: 'Coastal and two days.', price: '1.00', currency: 'EUR' },
          ],
        },
      },
    },
    async (base, backends) => {
      const ok = await post(base, '/api/recommend', { query: 'I want a coastal experience and only have two days.' });
      assert.equal(ok.res.status, 200);
      assert.deepEqual(ok.json.recommendations.map((r) => r.id), ['luderitz-bucht-coast']);
      assert.equal(ok.json.recommendations[0].pricePerTraveller, '129.00');
      assert.equal(ok.json.recommendations[0].currency, 'USD');
      assert.equal(backends.calls.gemini.length, 1);
      assertNoSecrets(ok.text, '/api/recommend');

      for (const body of [{}, { query: 42 }, { query: '  ' }, { query: 'x'.repeat(501) }]) {
        const bad = await post(base, '/api/recommend', body);
        assert.equal(bad.res.status, 400, JSON.stringify(body).slice(0, 40));
        assert.ok(['INVALID_QUERY', 'QUERY_TOO_LONG'].includes(bad.json.error.code));
      }
      assert.equal(backends.calls.gemini.length, 1, 'invalid requests must not reach Gemini');

      const malformed = await post(base, '/api/recommend', null, { raw: '{"query": ' });
      assert.equal(malformed.res.status, 400);
      assert.equal(malformed.json.error.code, 'INVALID_JSON');
    }
  );

  await withServer({ backends: { geminiStatus: 500 } }, async (base) => {
    const out = await post(base, '/api/recommend', { query: 'something coastal please' });
    assert.equal(out.res.status, 502);
    assert.equal(out.json.error.code, 'AI_UNAVAILABLE');
    assertNoSecrets(out.text, 'AI failure body');
    assert.ok(!/upstream detail/.test(out.text));
  });
});

test('HTTP: checkout validates ids and quantities and sends only server-calculated amounts to PayPal', opts, async () => {
  await withServer({}, async (base, backends) => {
    for (const body of [{}, { experienceId: 'nope', travellers: 1 }, { experienceId: '__proto__', travellers: 1 }, { experienceId: 7, travellers: 1 }]) {
      const r = await post(base, '/api/checkout/create-order', body);
      assert.equal(r.res.status, 400);
      assert.equal(r.json.error.code, 'INVALID_EXPERIENCE');
    }
    for (const travellers of [0, 11, -1, 1.5, 'abc', null, undefined, [], {}, '1e1']) {
      const r = await post(base, '/api/checkout/create-order', { experienceId: 'osaka-culture-food', travellers });
      assert.equal(r.res.status, 400, `travellers=${JSON.stringify(travellers)}`);
      assert.equal(r.json.error.code, 'INVALID_TRAVELLERS');
    }
    assert.equal(backends.calls.create.length, 0, 'rejected requests must never reach PayPal');

    const r = await post(base, '/api/checkout/create-order', {
      experienceId: 'osaka-culture-food',
      travellers: 2,
      price: '0.01',
      amount: { value: '0.01', currency_code: 'EUR' },
      unitAmount: '0.01',
      currency: 'EUR',
    });
    assert.equal(r.res.status, 200);
    assert.equal(r.json.amount, '378.00');
    assert.equal(r.json.currency, 'USD');
    assert.match(r.json.orderId, /^HTTPORDER-/);
    assert.match(r.json.bookingReference, /^DLD-[0-9A-F]{12}$/);
    assertNoSecrets(r.text, 'create-order');

    assert.equal(backends.calls.create.length, 1);
    const unit = backends.calls.create[0].purchase_units[0];
    assert.equal(unit.amount.value, '378.00');
    assert.equal(unit.amount.currency_code, 'USD');
    assert.equal(unit.items[0].unit_amount.value, '189.00');
    assert.equal(unit.items[0].quantity, '2');
    assert.equal(unit.custom_id, r.json.bookingReference);
    assert.equal(unit.reference_id, 'osaka-culture-food');
    assert.ok(!JSON.stringify(backends.calls.create[0]).includes('0.01'));
  });
});

test('HTTP: capture confirms only verified payments, never captures twice, and rejects bad order ids', opts, async () => {
  await withServer({}, async (base, backends) => {
    const created = (await post(base, '/api/checkout/create-order', { experienceId: 'paris-art-and-cafes', travellers: 1 })).json;

    const first = await post(base, '/api/checkout/capture', { orderId: created.orderId });
    assert.equal(first.res.status, 200);
    assert.equal(first.json.status, 'CONFIRMED');
    assert.equal(first.json.demonstration, true);
    assert.equal(first.json.amount, '219.00');
    assert.equal(first.json.currency, 'USD');
    assert.equal(first.json.paypalOrderId, created.orderId);
    assert.equal(first.json.paypalCaptureId, 'HTTPCAPTURE-1');
    assert.equal(first.json.bookingReference, created.bookingReference);
    assertNoSecrets(first.text, 'capture');

    const second = await post(base, '/api/checkout/capture', { orderId: created.orderId });
    assert.deepEqual(second.json, first.json);
    assert.equal(backends.calls.capture, 1);

    const missing = await post(base, '/api/checkout/capture', {});
    assert.equal(missing.res.status, 400);
    assert.equal(missing.json.error.code, 'INVALID_ORDER_ID');
    const malformed = await post(base, '/api/checkout/capture', { orderId: '../../etc/passwd' });
    assert.equal(malformed.res.status, 400);
    const unknown = await post(base, '/api/checkout/capture', { orderId: 'UNKNOWN-ORDER-1' });
    assert.equal(unknown.res.status, 404);
    assert.equal(unknown.json.error.code, 'ORDER_NOT_FOUND');
    assert.equal(backends.calls.capture, 1);
  });
});

test('HTTP: a capture that does not match the server record is not confirmed', opts, async () => {
  await withServer({ backends: { tamperAmount: true } }, async (base) => {
    const created = (await post(base, '/api/checkout/create-order', { experienceId: 'osaka-culture-food', travellers: 1 })).json;
    const r = await post(base, '/api/checkout/capture', { orderId: created.orderId });
    assert.equal(r.res.status, 502);
    assert.equal(r.json.error.code, 'CAPTURE_UNVERIFIED');
    assert.ok(!/CONFIRMED/.test(r.text));
    assert.ok(!/amount_mismatch/.test(r.text), 'internal diagnostics must not reach the client');
    const again = await post(base, '/api/checkout/capture', { orderId: created.orderId });
    assert.equal(again.res.status, 409);
    assert.equal(again.json.error.code, 'ORDER_NEEDS_REVIEW');
  });
});

test('HTTP: cancellation is recorded and blocks a later capture', opts, async () => {
  await withServer({}, async (base, backends) => {
    const created = (await post(base, '/api/checkout/create-order', { experienceId: 'sossusvlei-dunes', travellers: 1 })).json;
    const cancelled = await post(base, '/api/checkout/cancel', { orderId: created.orderId });
    assert.equal(cancelled.res.status, 200);
    assert.equal(cancelled.json.status, 'CANCELLED');
    const capture = await post(base, '/api/checkout/capture', { orderId: created.orderId });
    assert.equal(capture.res.status, 409);
    assert.equal(capture.json.error.code, 'ORDER_CANCELLED');
    assert.equal(backends.calls.capture, 0);
    assert.equal((await post(base, '/api/checkout/cancel', {})).res.status, 400);
  });
});

test('HTTP: oversized bodies are refused, unknown API routes return a safe JSON 404', opts, async () => {
  await withServer({}, async (base) => {
    const big = await post(base, '/api/recommend', { query: 'a'.repeat(20000) });
    assert.equal(big.res.status, 413);
    assert.equal(big.json.error.code, 'PAYLOAD_TOO_LARGE');

    const missing = await fetch(`${base}/api/does-not-exist`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'NOT_FOUND');
  });
});

test('HTTP: AI and checkout endpoints are rate limited with a Retry-After header', opts, async () => {
  await withServer({ aiLimit: 2, checkoutLimit: 2 }, async (base) => {
    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await post(base, '/api/recommend', { query: 'coastal escape' })).res.status);
    assert.deepEqual(statuses, [200, 200, 429]);
    const limited = await post(base, '/api/recommend', { query: 'coastal escape' });
    assert.equal(limited.res.status, 429);
    assert.equal(limited.json.error.code, 'RATE_LIMITED');
    assert.ok(Number(limited.res.headers.get('retry-after')) >= 1);

    const c = [];
    for (let i = 0; i < 3; i += 1) c.push((await post(base, '/api/checkout/cancel', {})).res.status);
    assert.deepEqual(c, [400, 400, 429]);
  });
});
