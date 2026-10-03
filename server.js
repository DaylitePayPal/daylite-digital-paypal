'use strict';

/**
 * Daylite Digital — PayPal AI Hackathon 2026 demonstration server.
 * Thin Express layer over service.js. All business rules live in the sibling modules.
 */

const path = require('node:path');
const express = require('express');

const { createService } = require('./service');
const { createPayPalClient } = require('./paypal');
const { securityHeaders, createRateLimiter } = require('./security');
const { AppError, toSafeBody } = require('./errors');
const catalog = require('./catalog');

// The repository root also holds source, package.json and (locally) .env, so static files are
// served from an explicit allowlist only. Nothing else in the repository is ever exposed.
const STATIC_FILES = Object.freeze({
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/styles.css': 'styles.css',
});

// Load .env for local development if present (Node >= 20.12). Real environment variables win.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (_) {
  /* no .env file: rely on the process environment */
}

function intFromEnv(name, fallback) {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * @param {{service?: object, aiLimit?: number, checkoutLimit?: number, paypalClientId?: string}} [overrides]
 */
function createApp(overrides = {}) {
  const paypalClient = createPayPalClient({
    clientId: process.env.PAYPAL_CLIENT_ID,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET,
  });
  const service =
    overrides.service ||
    createService({
      paypalClient,
      gemini: { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite' },
    });
  const paypalClientId = overrides.paypalClientId !== undefined ? overrides.paypalClientId : process.env.PAYPAL_CLIENT_ID;

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(express.json({ limit: '10kb' }));

  const aiLimiter = createRateLimiter({ max: overrides.aiLimit || intFromEnv('AI_RATE_LIMIT_PER_MINUTE', 10) });
  const checkoutLimiter = createRateLimiter({ max: overrides.checkoutLimit || intFromEnv('CHECKOUT_RATE_LIMIT_PER_MINUTE', 30) });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((result) => res.json(result)).catch(next);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/config', (req, res) => res.json(service.publicConfig({ paypalClientId })));
  app.get('/api/catalog', (req, res) => res.json({ demonstration: true, experiences: catalog.listPublic() }));

  app.post('/api/recommend', aiLimiter.middleware, wrap((req) => service.recommend(req.body && req.body.query)));
  app.post('/api/checkout/create-order', checkoutLimiter.middleware, wrap((req) => service.createCheckout(req.body)));
  app.post('/api/checkout/capture', checkoutLimiter.middleware, wrap((req) => service.captureCheckout(req.body)));
  app.post('/api/checkout/cancel', checkoutLimiter.middleware, wrap((req) => service.cancelCheckout(req.body)));

  app.use('/api', (req, res, next) => next(new AppError(404, 'NOT_FOUND', 'Not found.')));

  app.get(Object.keys(STATIC_FILES), (req, res, next) => {
    const file = Object.prototype.hasOwnProperty.call(STATIC_FILES, req.path) ? STATIC_FILES[req.path] : null;
    if (!file) return next(); // e.g. different letter case: fall through to the 404 below
    // `root` keeps the dotfile check relative to the repository, not the absolute checkout path.
    res.sendFile(file, { root: __dirname, maxAge: '5m', dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) next(err);
    });
  });

  // Everything else (including .env, source files and package.json) is a plain 404.
  app.use((req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });

  // Centralised, safe error responses: no stack traces or upstream detail reach the client.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let wrapped = err;
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      wrapped = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request is too large.');
    } else if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
      wrapped = new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
    }
    const { status, body } = toSafeBody(wrapped);
    if (status >= 500) {
      console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} -> ${status} ${wrapped.code || ''} ${wrapped.detail || (wrapped.message || '')}`);
    }
    res.status(status).json(body);
  });

  return app;
}

if (require.main === module) {
  const port = intFromEnv('PORT', 3000);
  const app = createApp();
  app.listen(port, () => {
    const hasPayPal = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
    const hasGemini = Boolean(process.env.GEMINI_API_KEY);
    console.log(`Daylite Digital demo listening on http://localhost:${port}`);
    console.log(`PayPal Sandbox configured: ${hasPayPal ? 'yes' : 'NO (set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)'}`);
    console.log(`Gemini configured: ${hasGemini ? 'yes' : 'NO (set GEMINI_API_KEY)'}`);
  });
}

module.exports = { createApp };
