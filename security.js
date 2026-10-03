'use strict';

/**
 * Small, dependency-free security helpers: response headers and an in-memory
 * fixed-window rate limiter. (A shared store such as Redis would be needed for
 * multi-instance deployments; this demonstration runs as a single process.)
 */

const { AppError } = require('./errors');

// Trusted PayPal hosts only. Widened to the paypal.com / paypalobjects.com families as a precaution
// because the SDK pulls sub-resources and frames from several of their subdomains. Confirm in a
// browser against the Sandbox (see docs/SETUP.md).
const PAYPAL_HOSTS = 'https://*.paypal.com https://*.paypalobjects.com';

const CSP = [
  "default-src 'self'",
  `script-src 'self' ${PAYPAL_HOSTS}`,
  `connect-src 'self' ${PAYPAL_HOSTS}`,
  `frame-src ${PAYPAL_HOSTS}`,
  "img-src 'self' data: https://*.paypal.com https://*.paypalobjects.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  res.removeHeader('X-Powered-By');
  next();
}

/**
 * Fixed-window limiter keyed by client IP.
 * @param {{windowMs?: number, max: number, now?: () => number}} opts
 */
function createRateLimiter({ windowMs = 60000, max, now = Date.now }) {
  const hits = new Map(); // key -> { count, resetAt }

  function check(key) {
    const t = now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (hits.size > 10000) {
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    }
    return { allowed: entry.count <= max, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)) };
  }

  function middleware(req, res, next) {
    const result = check(req.ip || 'unknown');
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      return next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.'));
    }
    return next();
  }

  return { check, middleware };
}

module.exports = { securityHeaders, createRateLimiter, CSP };
