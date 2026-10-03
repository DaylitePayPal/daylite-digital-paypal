'use strict';

/**
 * OFFLINE automated tests.
 *
 * PayPal and Gemini are replaced by in-process fake `fetch` implementations, so
 * no network access and no credentials are needed. The real ai.js, paypal.js,
 * catalog.js and service.js code runs against those fakes.
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(status, body) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

function makePayPalFetch({
  token = 'fake-paypal-access-token',
  orderId = 'ORDER-123',
  captureId = 'CAPTURE-456',
  captureStatus = 'COMPLETED',
  orderStatus = 'COMPLETED',
} = {}) {
  const calls = [];

  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url: String(url),
      options,
    });

    const method = String(options.method || 'GET').toUpperCase();
    const body =
      typeof options.body === 'string'
        ? JSON.parse(options.body)
        : options.body;

    if (String(url).endsWith('/v1/oauth2/token') && method === 'POST') {
      return jsonResponse(200, {
        access_token: token,
        token_type: 'Bearer',
        expires_in: 900,
      });
    }

    if (
      String(url).endsWith('/v2/checkout/orders') &&
      method === 'POST'
    ) {
      return jsonResponse(201, {
        id: orderId,
        status: 'CREATED',
        purchase_units: body.purchase_units,
      });
    }

    if (
      String(url).includes(`/v2/checkout/orders/${orderId}/capture`) &&
      method === 'POST'
    ) {
      return jsonResponse(201, {
        id: orderId,
        status: orderStatus,
        purchase_units: [
          {
            payments: {
              captures: [
                {
                  id: captureId,
                  status: captureStatus,
                  amount: {
                    currency_code: 'USD',
                    value: '249.00',
                  },
                },
              ],
            },
          },
        ],
      });
    }

    if (
      String(url).includes(`/v2/checkout/orders/${orderId}`) &&
      method === 'GET'
    ) {
      return jsonResponse(200, {
        id: orderId,
        status: orderStatus,
        purchase_units: [
          {
            payments: {
              captures: [
                {
                  id: captureId,
                  status: captureStatus,
                  amount: {
                    currency_code: 'USD',
                    value: '249.00',
                  },
                },
              ],
            },
          },
        ],
      });
    }

    return jsonResponse(404, {
      name: 'NOT_FOUND',
      message: 'fake PayPal endpoint not implemented',
    });
  };

  fetchImpl.calls = calls;

  return fetchImpl;
}

function makeGeminiFetch(body) {
  const calls = [];

  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url: String(url),
      options,
    });

    return jsonResponse(200, {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify(body),
              },
            ],
          },
        },
      ],
    });
  };

  fetchImpl.calls = calls;

  return fetchImpl;
}

function withFetch(fetchImpl, fn) {
  const original = globalThis.fetch;

  globalThis.fetch = fetchImpl;

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = original;
    });
}

function validExperience() {
  return catalog.getById('nyc-icons-neighbourhoods');
}

/* ------------------------------- catalogue -------------------------------- */

test('catalogue contains demonstration experiences', () => {
  const experiences = catalog.listPublic();

  assert.ok(Array.isArray(experiences));
  assert.ok(experiences.length >= 1);

  for (const experience of experiences) {
    assert.ok(experience.id);
    assert.ok(experience.name);
    assert.ok(experience.destination);
    assert.equal(typeof experience.priceCents, 'number');
    assert.equal(experience.currency, 'USD');

    assert.equal(
      Object.prototype.hasOwnProperty.call(experience, 'internalNotes'),
      false
    );
  }
});

test('catalogue returns known experience by ID', () => {
  const experience = validExperience();

  assert.ok(experience);
  assert.equal(experience.id, 'nyc-icons-neighbourhoods');
});

test('catalogue rejects unknown experience IDs', () => {
  assert.equal(catalog.getById('does-not-exist'), null);
});

/* ---------------------------------- AI ------------------------------------ */

test('AI matcher accepts valid Gemini recommendations', async () => {
  const fakeGemini = makeGeminiFetch({
    recommendations: [
      {
        experienceId: 'nyc-icons-neighbourhoods',
        reason: 'City landmarks and neighbourhood exploration match the request.',
      },
    ],
  });

  await withFetch(fakeGemini, async () => {
    const result = await ai.recommend({
      apiKey: 'fake-key',
      model: 'fake-model',
      query: 'I want a city sightseeing trip.',
      catalogue: catalog.listPublic(),
    });

    assert.equal(result.length, 1);
    assert.equal(
      result[0].experienceId,
      'nyc-icons-neighbourhoods'
    );
  });
});

test('AI matcher limits recommendations to three results', async () => {
  const fakeGemini = makeGeminiFetch({
    recommendations: [
      {
        experienceId: 'osaka-culture-street-food',
        reason: 'Food and culture.',
      },
      {
        experienceId: 'nyc-icons-neighbourhoods',
        reason: 'City exploration.',
      },
      {
        experienceId: 'luderitz-coastal-heritage',
        reason: 'Coastal heritage.',
      },
      {
        experienceId: 'paris-art-architecture',
        reason: 'Art and architecture.',
      },
    ],
  });

  await withFetch(fakeGemini, async () => {
    const result = await ai.recommend({
      apiKey: 'fake-key',
      model: 'fake-model',
      query: 'travel',
      catalogue: catalog.listPublic(),
    });

    assert.equal(result.length, 3);
  });
});

test('AI matcher rejects unknown catalogue IDs', async () => {
  const fakeGemini = makeGeminiFetch({
    recommendations: [
      {
        experienceId: 'not-a-real-experience',
        reason: 'Should not be accepted.',
      },
    ],
  });

  await withFetch(fakeGemini, async () => {
    await assert.rejects(
      () =>
        ai.recommend({
          apiKey: 'fake-key',
          model: 'fake-model',
          query: 'travel',
          catalogue: catalog.listPublic(),
        }),
      (err) => {
        assert.equal(err.code, 'AI_INVALID_RESPONSE');
        return true;
      }
    );
  });
});

/* -------------------------------- PayPal ---------------------------------- */

test('PayPal client obtains an access token and creates an order', async () => {
  const fakeFetch = makePayPalFetch();

  await withFetch(fakeFetch, async () => {
    const client = createPayPalClient({
      clientId: 'fake-client',
      clientSecret: 'fake-secret',
      fetchImpl: fakeFetch,
    });

    const order = await client.createOrder({
      bookingReference: 'DL-TEST-001',
      experience: validExperience(),
      travellers: 1,
      totalCents: validExperience().priceCents,
    });

    assert.equal(order.id, 'ORDER-123');
    assert.equal(order.status, 'CREATED');

    assert.ok(
      fakeFetch.calls.some((call) =>
        call.url.endsWith('/v1/oauth2/token')
      )
    );

    assert.ok(
      fakeFetch.calls.some((call) =>
        call.url.endsWith('/v2/checkout/orders')
      )
    );
  });
});

test('PayPal capture returns a completed capture', async () => {
  const fakeFetch = makePayPalFetch();

  await withFetch(fakeFetch, async () => {
    const client = createPayPalClient({
      clientId: 'fake-client',
      clientSecret: 'fake-secret',
      fetchImpl: fakeFetch,
    });

    const result = await client.captureOrder('ORDER-123');

    assert.equal(result.id, 'ORDER-123');
    assert.equal(result.status, 'COMPLETED');
  });
});

test('verifyCapture accepts matching completed capture', () => {
  const result = verifyCapture(
    {
      id: 'ORDER-123',
      status: 'COMPLETED',
      purchase_units: [
        {
          payments: {
            captures: [
              {
                id: 'CAPTURE-456',
                status: 'COMPLETED',
                amount: {
                  currency_code: 'USD',
                  value: '249.00',
                },
              },
            ],
          },
        },
      ],
    },
    {
      orderId: 'ORDER-123',
      captureId: 'CAPTURE-456',
      currency: 'USD',
      amountCents: 24900,
    }
  );

  assert.equal(result.captureId, 'CAPTURE-456');
});

test('verifyCapture rejects an amount mismatch', () => {
  assert.throws(
    () =>
      verifyCapture(
        {
          id: 'ORDER-123',
          status: 'COMPLETED',
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAPTURE-456',
                    status: 'COMPLETED',
                    amount: {
                      currency_code: 'USD',
                      value: '249.00',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          orderId: 'ORDER-123',
          captureId: 'CAPTURE-456',
          currency: 'USD',
          amountCents: 12900,
        }
      ),
    (err) => {
      assert.equal(err.code, 'PAYPAL_CAPTURE_MISMATCH');
      return true;
    }
  );
});

/* ------------------------------- service ---------------------------------- */

test('service validates traveller count', async () => {
  const service = createService({
    paypalClient: {},
    gemini: {},
  });

  await assert.rejects(
    () =>
      service.createCheckout({
        experienceId: validExperience().id,
        travellers: 0,
      }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('service validates experience ID', async () => {
  const service = createService({
    paypalClient: {},
    gemini: {},
  });

  await assert.rejects(
    () =>
      service.createCheckout({
        experienceId: 'does-not-exist',
        travellers: 2,
      }),
    (err) => {
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    }
  );
});

test('service creates a checkout using server-side pricing', async () => {
  const fakeFetch = makePayPalFetch();

  await withFetch(fakeFetch, async () => {
    const paypalClient = createPayPalClient({
      clientId: 'fake-client',
      clientSecret: 'fake-secret',
      fetchImpl: fakeFetch,
    });

    const service = createService({
      paypalClient,
      gemini: {},
    });

    const experience = validExperience();

    const result = await service.createCheckout({
      experienceId: experience.id,
      travellers: 2,
    });

    assert.equal(result.orderId, 'ORDER-123');
    assert.equal(result.amountCents, experience.priceCents * 2);
    assert.equal(result.currency, 'USD');
    assert.ok(result.bookingReference);
  });
});

/* ------------------------------- security --------------------------------- */

test('security headers expose the expected CSP', () => {
  const headers = {};

  const req = {};

  const res = {
    setHeader(name, value) {
      headers[name] = value;
    },
  };

  securityHeaders(req, res, () => {});

  assert.equal(headers['Content-Security-Policy'], CSP);
  assert.ok(headers['X-Content-Type-Options']);
  assert.ok(headers['X-Frame-Options']);
});

test('rate limiter blocks requests after the configured limit', () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });

  const req = {
    ip: 'flow-test-client',
  };

  const responses = [];

  function makeResponse() {
    return {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        responses.push(this);
        return this;
      },
    };
  }

  let nextCount = 0;

  limiter.middleware(req, makeResponse(), () => {
    nextCount += 1;
  });

  limiter.middleware(req, makeResponse(), () => {
    nextCount += 1;
  });

  assert.equal(nextCount, 1);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].statusCode, 429);
});

/* ------------------------------- errors ----------------------------------- */

test('AppError exposes safe status and code', () => {
  const error = new AppError(
    400,
    'TEST_ERROR',
    'Example error'
  );

  assert.equal(error.status, 400);
  assert.equal(error.code, 'TEST_ERROR');
  assert.equal(error.message, 'Example error');
});

test('toSafeBody hides unexpected internal details', () => {
  const result = toSafeBody(
    new Error('database password: super-secret-value')
  );

  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'INTERNAL_ERROR');
  assert.equal(
    result.body.error.message,
    'An unexpected error occurred.'
  );
  assert.equal(
    JSON.stringify(result.body).includes('super-secret-value'),
    false
  );
});

/* -------------------------- repository integrity -------------------------- */

test('repository browser files exist at the repository root', () => {
  const root = __dirname;

  const publicFiles = ['app.js', 'index.html'].map((file) =>
    fs.readFileSync(path.join(root, file), 'utf8')
  );

  assert.equal(publicFiles.length, 2);
  assert.ok(publicFiles.every((content) => content.length > 0));
});

test('repository source files exist at the repository root', () => {
  const root = __dirname;

  for (const file of [
    'ai.js',
    'catalog.js',
    'paypal.js',
    'service.js',
    'security.js',
    'server.js',
  ]) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');

    assert.ok(content.length > 0, `${file} should not be empty`);
  }
});

test('repository does not retain flattened-path references in executable test files', () => {
  const root = __dirname;

  for (const file of [
    'server.js',
    'flow.test.js',
    'http.test.js',
  ]) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');

    assert.equal(
      content.includes("require('./src/"),
      false,
      `${file} still contains a src/ import`
    );

    assert.equal(
      content.includes("path.join(__dirname, 'public'"),
      false,
      `${file} still expects a public/ directory`
    );
  }
});
