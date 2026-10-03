'use strict';

/**
 * OFFLINE automated tests.
 *
 * PayPal and Gemini are replaced by in-process fake `fetch` implementations, so
 * no network access and no credentials are needed. The real ai.js,
 * paypal.js, catalog.js and service.js code runs against those fakes.
 *
 * These tests do NOT prove behaviour against the live PayPal Sandbox or the live
 * Gemini API. See docs/SETUP.md for the manual live-Sandbox checklist.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalog = require('./catalog');
const ai = require('./ai');
const { createPayPalClient, verifyCapture } = require('./paypal');
const { createService } = require('./service');
const { createRateLimiter, securityHeaders, CSP } = require('./security');
const { AppError, toSafeBody } = require('./errors');

/* ----------------------------- fakes / helpers ----------------------------- */

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Fake Gemini endpoint. `reply` is the JSON text the "model" returns. */
function fakeGemini(reply, { status = 200, rawBody } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    if (status !== 200) return jsonResponse(status, { error: { message: 'secret upstream detail' } });
    if (rawBody !== undefined) return jsonResponse(200, rawBody);
    return jsonResponse(200, { candidates: [{ content: { parts: [{ text: typeof reply === 'string' ? reply : JSON.stringify(reply) }] } }] });
  };
  return { fetchImpl, calls };
}

/** Fake PayPal Sandbox. `capture(order)` may return {status, json} to override the capture response. */
function fakePayPal({ capture, readBack } = {}) {
  const calls = { token: 0, create: [], capture: [] };
  const orders = new Map();
  let n = 0;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const headers = init.headers || {};
    if (u.pathname === '/v1/oauth2/token') {
      calls.token += 1;
      calls.tokenHeaders = headers;
      return jsonResponse(200, { access_token: 'fake-access-token', expires_in: 3600 });
    }
    if (u.pathname === '/v2/checkout/orders' && init.method === 'POST') {
      const body = JSON.parse(init.body);
      n += 1;
      const id = `ORDER-${n}0000`;
      orders.set(id, body);
      calls.create.push({ body, headers });
      return jsonResponse(201, { id, status: 'CREATED' });
    }
    const m = u.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      calls.capture.push({ id, headers });
      const order = orders.get(id);
      if (capture) {
        const custom = capture(order, id);
        if (custom) return jsonResponse(custom.status, custom.json);
      }
      return jsonResponse(201, successCapture(order, id));
    }
    const g = u.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
    if (g && init.method === 'GET') {
      const id = decodeURIComponent(g[1]);
      calls.get = (calls.get || 0) + 1;
      const order = orders.get(id);
      if (!order) return jsonResponse(404, {});
      const custom = readBack ? readBack(order, id) : null;
      return jsonResponse(200, custom || successCapture(order, id));
    }
    return jsonResponse(404, {});
  };
  return { fetchImpl, calls, orders };
}

function successCapture(order, id, mutate) {
  const unit = order.purchase_units[0];
  const res = {
    id,
    status: 'COMPLETED',
    purchase_units: [
      {
        reference_id: unit.reference_id,
        payments: {
          captures: [
            { id: 'CAPTURE-ABC123', status: 'COMPLETED', amount: { currency_code: unit.amount.currency_code, value: unit.amount.value }, custom_id: unit.custom_id },
          ],
        },
      },
    ],
  };
  if (mutate) mutate(res);
  return res;
}

function build({ paypalOpts, geminiReply, geminiOpts } = {}) {
  const pp = fakePayPal(paypalOpts);
  const gm = fakeGemini(geminiReply === undefined ? { recommendations: [] } : geminiReply, geminiOpts);
  let counter = 0;
  const service = createService({
    paypalClient: createPayPalClient({ clientId: 'cid', clientSecret: 'csecret', fetchImpl: pp.fetchImpl }),
    gemini: { apiKey: 'gkey', model: 'test-model', fetchImpl: gm.fetchImpl },
    now: () => new Date('2026-10-03T10:00:00Z'),
    newReference: () => `DLD-TEST${String(++counter).padStart(4, '0')}`,
  });
  return { service, pp, gm };
}

async function rejectsWith(promiseOrFn, code, status) {
  try {
    await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
  } catch (err) {
    assert.ok(err instanceof AppError, `expected AppError, got ${err && err.stack}`);
    assert.equal(err.code, code);
    if (status) assert.equal(err.status, status);
    return err;
  }
  assert.fail(`expected rejection with ${code}`);
}

/* --------------------------------- catalogue -------------------------------- */

test('catalogue: entries are complete, USD, demonstration data with integer-cent prices', () => {
  assert.ok(catalog.CATALOG.length >= 6);
  const ids = new Set();
  for (const e of catalog.CATALOG) {
    for (const k of ['id', 'name', 'location', 'description']) assert.ok(typeof e[k] === 'string' && e[k].length > 0, `${e.id}.${k}`);
    assert.ok(Number.isInteger(e.priceCents) && e.priceCents > 0);
    assert.ok(!ids.has(e.id), 'duplicate id');
    ids.add(e.id);
  }
  assert.equal(catalog.CURRENCY, 'USD');
  for (const p of catalog.listPublic()) {
    assert.equal(p.demonstration, true);
    assert.match(p.pricePerTraveller, /^\d+\.\d{2}$/);
  }
});

test('catalogue: unknown, prototype-like and non-string ids are rejected', () => {
  for (const bad of ['nope', '', '__proto__', 'constructor', 'toString', null, undefined, 42, {}, ['osaka-culture-food']]) {
    assert.equal(catalog.getExperience(bad), undefined, String(bad));
  }
  assert.ok(catalog.getExperience('osaka-culture-food'));
});

test('catalogue: traveller quantity validation accepts 1-10 whole numbers only', () => {
  assert.equal(catalog.parseTravellers(1), 1);
  assert.equal(catalog.parseTravellers(10), 10);
  assert.equal(catalog.parseTravellers('3'), 3);
  for (const bad of [0, 11, -1, 2.5, NaN, Infinity, '', 'abc', '1e1', '3; DROP', null, undefined, true, [], {}]) {
    assert.equal(catalog.parseTravellers(bad), null, String(bad));
  }
});

test('catalogue: server-side price calculation is exact (integer cents)', () => {
  const t = catalog.calculateTotal('cape-town-coast-and-table-mountain', 7);
  assert.equal(t.unitAmount, '159.00');
  assert.equal(t.totalAmount, '1113.00');
  assert.equal(t.currency, 'USD');
  assert.equal(catalog.calculateTotal('osaka-culture-food', 3).totalAmount, '567.00');
  assert.equal(catalog.calculateTotal('unknown', 1), null);
  assert.equal(catalog.calculateTotal('osaka-culture-food', 0), null);
});

/* ------------------------------------ AI ------------------------------------ */

test('AI: valid recommendation is returned with catalogue-authoritative data', async () => {
  const { service } = build({
    geminiReply: { recommendations: [{ experienceId: 'osaka-culture-food', reason: 'Temples, tea and street food suit a cultural trip.' }] },
  });
  const out = await service.recommend('I want a cultural experience in Osaka.');
  assert.equal(out.demonstration, true);
  assert.equal(out.recommendations.length, 1);
  const r = out.recommendations[0];
  assert.equal(r.id, 'osaka-culture-food');
  assert.equal(r.name, catalog.getExperience('osaka-culture-food').name);
  assert.equal(r.pricePerTraveller, '189.00');
  assert.equal(r.currency, 'USD');
  assert.match(r.reason, /street food/);
});

test('AI: invented experience ids are dropped; valid ones survive', () => {
  const out = ai.validateModelOutput(
    JSON.stringify({ recommendations: [{ experienceId: 'atlantis-spa', reason: 'x' }, { experienceId: 'luderitz-bucht-coast', reason: 'Coastal and two days.' }] })
  );
  assert.deepEqual(out.map((r) => r.id), ['luderitz-bucht-coast']);
});

test('AI: reply naming only invalid experiences is rejected, not displayed', async () => {
  const { service } = build({ geminiReply: { recommendations: [{ experienceId: 'mars-base', reason: 'Cool.' }] } });
  await rejectsWith(service.recommend('anything exotic please'), 'AI_INVALID_RECOMMENDATIONS', 502);
});

test('AI: model-supplied price/name/currency fields cannot override the catalogue', () => {
  const out = ai.validateModelOutput(
    JSON.stringify({ recommendations: [{ experienceId: 'paris-art-and-cafes', reason: 'Art lovers.', price: '0.01', pricePerTraveller: '0.01', name: 'FREE PARIS', currency: 'EUR' }] })
  );
  assert.equal(out[0].pricePerTraveller, '219.00');
  assert.equal(out[0].name, catalog.getExperience('paris-art-and-cafes').name);
  assert.equal(out[0].currency, 'USD');
  assert.equal(out[0].price, undefined);
});

test('AI: results are de-duplicated, capped at 3, and malformed output fails safely', async () => {
  const many = catalog.listIds().flatMap((id) => [{ experienceId: id, reason: 'r' }, { experienceId: id, reason: 'again' }]);
  const out = ai.validateModelOutput(JSON.stringify({ recommendations: many }));
  assert.equal(out.length, 3);
  assert.equal(new Set(out.map((r) => r.id)).size, 3);

  assert.throws(() => ai.validateModelOutput('not json at all'), (e) => e.code === 'AI_BAD_RESPONSE');
  assert.throws(() => ai.validateModelOutput(JSON.stringify({ nope: [] })), (e) => e.code === 'AI_BAD_RESPONSE');
  assert.deepEqual(ai.validateModelOutput(JSON.stringify({ recommendations: [] })), []);
});

test('AI: Gemini request uses server-side key header, configured model, JSON schema, and no prices', async () => {
  const { service, gm } = build({ geminiReply: { recommendations: [] } });
  await service.recommend('I want a coastal experience and only have two days.');
  const call = gm.calls[0];
  assert.match(call.url, /\/models\/test-model:generateContent$/);
  assert.equal(call.init.headers['x-goog-api-key'], 'gkey');
  assert.ok(!call.url.includes('gkey'), 'key must not be in the URL');
  assert.ok(!call.init.body.includes('gkey'), 'key must not be in the body');
  const cfg = call.body.generationConfig;
  assert.equal(cfg.responseMimeType, 'application/json');
  assert.deepEqual(cfg.responseSchema.properties.recommendations.items.properties.experienceId.enum, catalog.listIds());
  assert.match(call.body.contents[0].parts[0].text, /coastal experience/);
  const sys = call.body.systemInstruction.parts[0].text;
  assert.ok(!/priceCents|189\.00|18900/.test(sys), 'prices must not be sent to the model');
  assert.match(sys, /untrusted/i);
});

test('AI: query validation, missing configuration, and upstream failures are safe', async () => {
  const { service } = build();
  await rejectsWith(service.recommend(''), 'INVALID_QUERY', 400);
  await rejectsWith(service.recommend(42), 'INVALID_QUERY', 400);
  await rejectsWith(service.recommend('x'.repeat(ai.MAX_QUERY + 1)), 'QUERY_TOO_LONG', 400);

  await rejectsWith(ai.recommend('cultural trip', {}), 'AI_NOT_CONFIGURED', 503);

  const failing = build({ geminiOpts: { status: 500 }, geminiReply: {} });
  const err = await rejectsWith(failing.service.recommend('cultural trip please'), 'AI_UNAVAILABLE', 502);
  assert.ok(!JSON.stringify(toSafeBody(err)).includes('secret upstream detail'));
});

/* ------------------------------ PayPal checkout ----------------------------- */

test('PayPal: order is created with server-calculated amount, custom_id and idempotency header', async () => {
  const { service, pp } = build();
  const out = await service.createCheckout({ experienceId: 'sossusvlei-dunes', travellers: 2 });
  assert.equal(out.amount, '558.00');
  assert.equal(out.currency, 'USD');
  assert.equal(out.bookingReference, 'DLD-TEST0001');
  assert.match(out.orderId, /^ORDER-/);

  const sent = pp.calls.create[0].body;
  assert.equal(sent.intent, 'CAPTURE');
  const unit = sent.purchase_units[0];
  assert.equal(unit.amount.value, '558.00');
  assert.equal(unit.amount.currency_code, 'USD');
  assert.equal(unit.amount.breakdown.item_total.value, '558.00');
  assert.equal(unit.reference_id, 'sossusvlei-dunes');
  assert.equal(unit.custom_id, 'DLD-TEST0001'); // payment traceability
  assert.equal(unit.items[0].quantity, '2');
  assert.equal(unit.items[0].unit_amount.value, '279.00');
  assert.equal(pp.calls.create[0].headers['PayPal-Request-Id'], 'dld-create-DLD-TEST0001');
  assert.equal(pp.calls.create[0].headers.Authorization, 'Bearer fake-access-token');
  assert.equal(pp.calls.tokenHeaders.Authorization, `Basic ${Buffer.from('cid:csecret').toString('base64')}`);
});

test('PayPal: browser-supplied price, amount and currency are ignored', async () => {
  const { service, pp } = build();
  const out = await service.createCheckout({ experienceId: 'osaka-culture-food', travellers: 1, price: '0.01', amount: '0.01', currency: 'EUR', priceCents: 1 });
  assert.equal(out.amount, '189.00');
  assert.equal(out.currency, 'USD');
  assert.equal(pp.calls.create[0].body.purchase_units[0].amount.value, '189.00');
});

test('PayPal: invalid catalogue ids are rejected before any PayPal call', async () => {
  const { service, pp } = build();
  for (const bad of ['nope', '', null, undefined, 7, '__proto__']) {
    await rejectsWith(service.createCheckout({ experienceId: bad, travellers: 1 }), 'INVALID_EXPERIENCE', 400);
  }
  await rejectsWith(service.createCheckout(null), 'INVALID_EXPERIENCE', 400);
  assert.equal(pp.calls.create.length, 0);
  assert.equal(pp.calls.token, 0);
});

test('PayPal: invalid traveller quantities are rejected before any PayPal call', async () => {
  const { service, pp } = build();
  for (const bad of [0, -3, 11, 2.5, '1; DROP TABLE', null, undefined, NaN]) {
    await rejectsWith(service.createCheckout({ experienceId: 'osaka-culture-food', travellers: bad }), 'INVALID_TRAVELLERS', 400);
  }
  assert.equal(pp.calls.create.length, 0);
});

test('PayPal: capture returns a verified demonstration confirmation', async () => {
  const { service, pp } = build();
  const created = await service.createCheckout({ experienceId: 'luderitz-bucht-coast', travellers: 3 });
  const c = await service.captureCheckout({ orderId: created.orderId });
  assert.equal(c.status, 'CONFIRMED');
  assert.equal(c.demonstration, true);
  assert.equal(c.bookingReference, created.bookingReference);
  assert.equal(c.experience.id, 'luderitz-bucht-coast');
  assert.equal(c.travellers, 3);
  assert.equal(c.amount, '387.00');
  assert.equal(c.currency, 'USD');
  assert.equal(c.paypalOrderId, created.orderId);
  assert.equal(c.paypalCaptureId, 'CAPTURE-ABC123');
  assert.match(c.notice, /Sandbox/);
  assert.equal(pp.calls.capture[0].headers['PayPal-Request-Id'], `dld-capture-${created.orderId}`);
});

test('PayPal: a second capture of the same order does not capture twice', async () => {
  const { service, pp } = build();
  const created = await service.createCheckout({ experienceId: 'osaka-culture-food', travellers: 1 });
  const first = await service.captureCheckout({ orderId: created.orderId });
  const second = await service.captureCheckout({ orderId: created.orderId });
  assert.deepEqual(second, first);
  assert.equal(pp.calls.capture.length, 1);

  // Concurrent attempts: only one reaches PayPal.
  const b = build();
  const o = await b.service.createCheckout({ experienceId: 'osaka-culture-food', travellers: 1 });
  const results = await Promise.allSettled([b.service.captureCheckout({ orderId: o.orderId }), b.service.captureCheckout({ orderId: o.orderId })]);
  assert.equal(b.pp.calls.capture.length, 1);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'CAPTURE_IN_PROGRESS');
});

test('PayPal: declined payment is reported as declined, is not confirmed, and can be retried', async () => {
  let attempt = 0;
  const { service } = build({
    paypalOpts: {
      capture: (order, id) => {
        attempt += 1;
        if (attempt === 1) return { status: 422, json: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] } };
        return null; // default success on retry
      },
    },
  });
  const created = await service.createCheckout({ experienceId: 'paris-art-and-cafes', travellers: 2 });
  const err = await rejectsWith(service.captureCheckout({ orderId: created.orderId }), 'PAYMENT_DECLINED', 402);
  assert.match(err.message, /declined/i);
  const ok = await service.captureCheckout({ orderId: created.orderId });
  assert.equal(ok.status, 'CONFIRMED');
});

test('PayPal: cancellation marks the order cancelled and blocks later capture', async () => {
  const { service, pp } = build();
  const created = await service.createCheckout({ experienceId: 'osaka-culture-food', travellers: 1 });
  const out = service.cancelCheckout({ orderId: created.orderId });
  assert.equal(out.status, 'CANCELLED');
  assert.match(out.message, /not been charged/);
  await rejectsWith(service.captureCheckout({ orderId: created.orderId }), 'ORDER_CANCELLED', 409);
  assert.equal(pp.calls.capture.length, 0);

  // A confirmed order cannot be cancelled afterwards.
  const c2 = await service.createCheckout({ experienceId: 'osaka-culture-food', travellers: 1 });
  await service.captureCheckout({ orderId: c2.orderId });
  assert.throws(() => service.cancelCheckout({ orderId: c2.orderId }), (e) => e.code === 'ORDER_ALREADY_CONFIRMED');
});

test('PayPal: unapproved order, unknown order and malformed order ids fail safely', async () => {
  const { service } = build({ paypalOpts: { capture: () => ({ status: 422, json: { details: [{ issue: 'ORDER_NOT_APPROVED' }] } }) } });
  const created = await service.createCheckout({ experienceId: 'osaka-culture-food', travellers: 1 });
  await rejectsWith(service.captureCheckout({ orderId: created.orderId }), 'ORDER_NOT_APPROVED', 409);
  await rejectsWith(service.captureCheckout({ orderId: 'ORDER-NOT-OURS' }), 'ORDER_NOT_FOUND', 404);
  for (const bad of [undefined, null, '', '../etc/passwd', 'a b', 12345]) {
    await rejectsWith(service.captureCheckout({ orderId: bad }), 'INVALID_ORDER_ID', 400);
  }
});

test('PayPal: missing confirmation data (no capture id / no captures / no purchase units) is never confirmed', async () => {
  const variants = [
    (r) => { delete r.purchase_units[0].payments.captures[0].id; },
    (r) => { r.purchase_units[0].payments.captures = []; },
    (r) => { r.purchase_units = []; },
    (r) => { r.status = 'PAYER_ACTION_REQUIRED'; },
    (r) => { r.purchase_units[0].payments.captures[0].status = 'PENDING'; },
    (r) => { delete r.purchase_units[0].payments.captures[0].amount; },
  ];
  for (const mutate of variants) {
    const { service } = build({ paypalOpts: { capture: (order, id) => ({ status: 201, json: successCapture(order, id, mutate) }) } });
    const created = await service.createCheckout({ experienceId: 'osaka-culture-food', travellers: 1 });
    await rejectsWith(service.captureCheckout({ orderId: created.orderId }), 'CAPTURE_UNVERIFIED', 502);
    // Fails closed: state is parked for review, never confirmed, not silently retried.
    await rejectsWith(service.captureCheckout({ orderId: created.orderId }), 'ORDER_NEEDS_REVIEW', 409);
  }
});

test('PayPal: captured amount, currency and traceability fields must match the server record', async () => {
  const cases = {
    amount: (r) => { r.purchase_units[0].payments.captures[0].amount.value = '1.00'; },
    currency: (r) => { r.purchase_units[0].payments.captures[0].amount.currency_code = 'EUR'; },
    custom_id: (r) => { r.purchase_units[0].payments.captures[0].custom_id = 'DLD-SOMEONE-ELSE'; },
    reference_id: (r) => { r.purchase_units[0].reference_id = 'paris-art-and-cafes'; },
    order_id: (r) => { r.id = 'ORDER-DIFFERENT'; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const { service } = build({ paypalOpts: { capture: (order, id) => ({ status: 201, json: successCapture(order, id, mutate) }) } });
    const created = await service.createCheckout({ experienceId: 'osaka-culture-food', travellers: 2 });
    await rejectsWith(service.captureCheckout({ orderId: created.orderId }), 'CAPTURE_UNVERIFIED', 502).catch((e) => {
      throw new Error(`${name}: ${e.message}`);
    });
  }
  // Direct unit check of the verifier, including exact-decimal comparison.
  const expected = { orderId: 'O-1', amount: '378.00', currency: 'USD', bookingReference: 'DLD-1', experienceId: 'osaka-culture-food' };
  const good = { id: 'O-1', status: 'COMPLETED', purchase_units: [{ reference_id: 'osaka-culture-food', payments: { captures: [{ id: 'C1', status: 'COMPLETED', amount: { value: '378.00', currency_code: 'USD' }, custom_id: 'DLD-1' }] } }] };
  assert.equal(verifyCapture(good, expected).captureId, 'C1');
  assert.throws(() => verifyCapture(null, expected), (e) => e.code === 'CAPTURE_UNVERIFIED');
});

test('PayPal: capture/auth upstream failures are safe and the access token is cached', async () => {
  const { service, pp } = build({ paypalOpts: { capture: () => ({ status: 500, json: { message: 'internal paypal detail' } }) } });
  const a = await service.createCheckout({ experienceId: 'osaka-culture-food', travellers: 1 });
  await service.createCheckout({ experienceId: 'osaka-culture-food', travellers: 1 });
  assert.equal(pp.calls.token, 1, 'OAuth token should be reused');
  const err = await rejectsWith(service.captureCheckout({ orderId: a.orderId }), 'PAYPAL_CAPTURE_FAILED', 502);
  assert.ok(!JSON.stringify(toSafeBody(err)).includes('internal paypal detail'));

  const unconfigured = createPayPalClient({ fetchImpl: async () => { throw new Error('should not be called'); } });
  await rejectsWith(unconfigured.getAccessToken(), 'PAYPAL_NOT_CONFIGURED', 503);
});

/* ------------------------- security / configuration ------------------------- */

test('security: public config exposes only the public client id, never the secret', () => {
  const { service } = build();
  const cfg = JSON.stringify(service.publicConfig({ paypalClientId: 'public-client-id' }));
  assert.match(cfg, /public-client-id/);
  assert.ok(!cfg.includes('csecret'));
  assert.ok(!cfg.includes('gkey'));
});

test('security: AI rate limiter blocks after the limit and recovers after the window', () => {
  let t = 1000;
  const limiter = createRateLimiter({ windowMs: 60000, max: 3, now: () => t });
  assert.equal(limiter.check('1.2.3.4').allowed, true);
  assert.equal(limiter.check('1.2.3.4').allowed, true);
  assert.equal(limiter.check('1.2.3.4').allowed, true);
  const blocked = limiter.check('1.2.3.4');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  assert.equal(limiter.check('5.6.7.8').allowed, true, 'other clients are unaffected');
  t += 61000;
  assert.equal(limiter.check('1.2.3.4').allowed, true);

  // Middleware form produces a 429 AppError.
  const mw = createRateLimiter({ max: 1 }).middleware;
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  let forwarded;
  mw({ ip: 'x' }, res, () => {});
  mw({ ip: 'x' }, res, (err) => { forwarded = err; });
  assert.equal(forwarded.status, 429);
  assert.ok(headers['Retry-After']);
});

test('security: headers are set, CSP forbids inline script, and errors never leak internals', () => {
  const set = {};
  securityHeaders({}, { setHeader: (k, v) => { set[k] = v; }, removeHeader: () => {} }, () => {});
  assert.equal(set['X-Content-Type-Options'], 'nosniff');
  assert.equal(set['X-Frame-Options'], 'DENY');
  assert.ok(set['Content-Security-Policy']);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(CSP));
  assert.ok(/frame-ancestors 'none'/.test(CSP));

  const { status, body } = toSafeBody(new Error('db password is hunter2'));
  assert.equal(status, 500);
  assert.ok(!JSON.stringify(body).includes('hunter2'));
});

test('security: client code and repository source contain no secrets or dangerous DOM sinks', () => {
  const root = __dirname;
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const clientFiles = ['app.js', 'index.html'].map(read);
  for (const text of clientFiles) {
    assert.ok(!/CLIENT_SECRET|GEMINI_API_KEY|AIza[0-9A-Za-z_-]{20,}/.test(text));
  }
  const appJs = clientFiles[0];
  assert.ok(!/\.innerHTML\s*=/.test(appJs), 'app.js must render dynamic text with textContent, not innerHTML');
  assert.ok(!/\beval\(|new Function\(/.test(appJs));
  for (const f of ['ai.js', 'catalog.js', 'paypal.js', 'service.js', 'security.js', 'errors.js', 'server.js']) {
    const text = read(f);
    assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(text), f);
    assert.ok(!/api-m\.paypal\.com/.test(text), `${f} must not reference the PayPal live API`);
  }
});

test('repository integrity: flat layout, complete files, .env ignored, example holds placeholders only', () => {
  const root = __dirname;
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

  // Every file the app needs exists at the repository root and none is a truncated stub.
  const required = {
    'server.js': 80,
    'ai.js': 60,
    'catalog.js': 60,
    'errors.js': 10,
    'paypal.js': 100,
    'security.js': 30,
    'service.js': 100,
    'index.html': 40,
    'app.js': 150,
    'styles.css': 50,
    'flow.test.js': 300,
    'http.test.js': 150,
  };
  for (const [file, minLines] of Object.entries(required)) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
    assert.ok(read(file).split('\n').length >= minLines, `${file} looks truncated (fewer than ${minLines} lines)`);
  }
  // The files that were previously truncated must end with their real closing code.
  assert.match(read('server.js'), /module\.exports\s*=\s*\{\s*createApp\s*\}/);
  assert.match(read('flow.test.js'), /\n\}\);\s*$/);
  assert.match(read('http.test.js'), /\n\}\);\s*$/);

  // No stale references to the old nested layout, and no directories that would reintroduce it.
  const stale = ['./' + 'src/', "'public'", '/public/'];
  for (const f of ['server.js', 'ai.js', 'catalog.js', 'paypal.js', 'service.js', 'security.js', 'errors.js', 'http.test.js']) {
    for (const needle of stale) assert.ok(!read(f).includes(needle), `${f} still references ${needle}`);
  }
  for (const dir of ['src', 'public']) {
    assert.ok(!fs.existsSync(path.join(root, dir)), `${dir}/ must not exist in the flat layout`);
  }

  // .env is never committed: it must be git-ignored. The example file holds placeholders only.
  assert.match(read('.gitignore'), /^\.env\s*$/m, '.env must be listed in .gitignore');
  const example = read('.env.example');
  assert.match(example, /^PAYPAL_CLIENT_ID=your-/m);
  assert.match(example, /^PAYPAL_CLIENT_SECRET=your-/m);
  assert.match(example, /^GEMINI_API_KEY=your-/m);
  assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(example));
});

/* --------------------- additional review-driven tests ---------------------- */

test('AI: model-authored money claims are never displayed; harmless numbers are kept', () => {
  const reasons = {
    'luderitz-bucht-coast': 'A bargain at only $50 for the whole trip.',
    'osaka-culture-food': 'Great value, the price is low.',
    'paris-art-and-cafes': 'Roughly 20% cheaper than usual.',
    'sossusvlei-dunes': 'Two days of dunes and stargazing in the Namib.',
  };
  const out = ai.validateModelOutput(
    JSON.stringify({ recommendations: Object.entries(reasons).map(([experienceId, reason]) => ({ experienceId, reason })) })
  );
  // capped at 3 and best-first, so check the first three by id
  const byId = Object.fromEntries(out.map((r) => [r.id, r.reason]));
  assert.equal(byId['luderitz-bucht-coast'], 'Matches your request based on the demonstration catalogue.');
  assert.equal(byId['osaka-culture-food'], 'Matches your request based on the demonstration catalogue.');
  assert.equal(byId['paris-art-and-cafes'], 'Matches your request based on the demonstration catalogue.');
  const fourth = ai.validateModelOutput(JSON.stringify({ recommendations: [{ experienceId: 'sossusvlei-dunes', reason: reasons['sossusvlei-dunes'] }] }));
  assert.match(fourth[0].reason, /Two days of dunes/);
  // the price shown is always the catalogue price, whatever the reason said
  assert.equal(out[0].pricePerTraveller, '129.00');
});

test('AI: GEMINI_MODEL is honoured as configured, unsafe model names are refused, and output headroom is kept', async () => {
  for (const model of ['alpha-model-1', 'beta.model-2.5-x']) {
    const gm = fakeGemini({ recommendations: [] });
    await ai.recommend('a quiet coastal weekend', { apiKey: 'k', model, fetchImpl: gm.fetchImpl });
    assert.ok(gm.calls[0].url.includes(`/models/${model}:generateContent`), `url should use ${model}`);
    assert.ok(gm.calls[0].body.generationConfig.maxOutputTokens >= 2048);
    assert.equal(gm.calls[0].body.generationConfig.responseMimeType, 'application/json');
  }
  for (const bad of ['..', '../x', '.hidden', 'a/b', 'a b', 'm?x=1', '']) {
    const gm = fakeGemini({ recommendations: [] });
    await rejectsWith(ai.recommend('a quiet coastal weekend', { apiKey: 'k', model: bad, fetchImpl: gm.fetchImpl }), 'AI_NOT_CONFIGURED', 503);
    assert.equal(gm.calls.length, 0, `no upstream call for model "${bad}"`);
  }
});

test('PayPal: item category is a supported Orders v2 value, never TRAVEL; item totals add up server-side', async () => {
  const { service, pp } = build();
  await service.createCheckout({ experienceId: 'paris-art-and-cafes', travellers: 3, category: 'TRAVEL', currency: 'EUR' });
  const unit = pp.calls.create[0].body.purchase_units[0];
  const item = unit.items[0];
  assert.ok(['DIGITAL_GOODS', 'PHYSICAL_GOODS', 'DONATION'].includes(item.category), `unsupported category ${item.category}`);
  assert.notEqual(item.category, 'TRAVEL');
  assert.equal(unit.amount.currency_code, 'USD');
  assert.equal(item.unit_amount.currency_code, 'USD');
  assert.equal(Math.round(Number(item.unit_amount.value) * 100) * Number(item.quantity), Math.round(Number(unit.amount.value) * 100));
  assert.equal(unit.amount.breakdown.item_total.value, unit.amount.value);
  assert.equal(JSON.stringify(pp.calls.create[0].body).includes('TRAVEL'), false);
});

test('PayPal: an already-captured order is read back and still verified before confirming', async () => {
  const alreadyCaptured = { status: 422, json: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] } };
  const ok = build({ paypalOpts: { capture: () => alreadyCaptured } });
  const created = await ok.service.createCheckout({ experienceId: 'osaka-culture-food', travellers: 2 });
  const confirmed = await ok.service.captureCheckout({ orderId: created.orderId });
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal(confirmed.paypalCaptureId, 'CAPTURE-ABC123');
  assert.equal(ok.pp.calls.get, 1);

  // If the read-back does not match the server's record, nothing is confirmed.
  const bad = build({
    paypalOpts: {
      capture: () => alreadyCaptured,
      readBack: (order, id) => successCapture(order, id, (r) => { r.purchase_units[0].payments.captures[0].amount.value = '0.01'; }),
    },
  });
  const c2 = await bad.service.createCheckout({ experienceId: 'osaka-culture-food', travellers: 2 });
  await rejectsWith(bad.service.captureCheckout({ orderId: c2.orderId }), 'CAPTURE_UNVERIFIED', 502);
  await rejectsWith(bad.service.captureCheckout({ orderId: c2.orderId }), 'ORDER_NEEDS_REVIEW', 409);
});

test('PayPal: capture amount strings must be exact two-decimal money', () => {
  const expected = { orderId: 'O-1', amount: '378.00', currency: 'USD', bookingReference: 'DLD-1', experienceId: 'osaka-culture-food' };
  const make = (value) => ({ id: 'O-1', status: 'COMPLETED', purchase_units: [{ reference_id: 'osaka-culture-food', payments: { captures: [{ id: 'C1', status: 'COMPLETED', amount: { value, currency_code: 'USD' }, custom_id: 'DLD-1' }] } }] });
  assert.equal(verifyCapture(make('378.00'), expected).amount, '378.00');
  for (const value of ['378.001', '3.78e2', ' 378.00', '-378.00', '0x17A', '378.0.0', '', '377.99', '378.01']) {
    assert.throws(() => verifyCapture(make(value), expected), (e) => e instanceof AppError && e.code === 'CAPTURE_UNVERIFIED', `value ${JSON.stringify(value)}`);
  }
});
