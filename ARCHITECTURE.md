# Architecture

## Overview

```
Browser (public/)                Express (server.js)             src/ modules              External
─────────────────                ───────────────────             ────────────              ────────
POST /api/recommend  ─────────►  rate limit (AI) ───────────────► service.recommend
                                                                    └► ai.recommend ──────► Gemini REST
                                                                    └► validate vs catalog
POST /api/checkout/create-order ► rate limit ──────────────────► service.createCheckout
                                                                    └► catalog.calculateTotal
                                                                    └► paypal.createOrder ─► PayPal Sandbox
PayPal SDK popup (approval) ◄──────────────────────────────────────────────────────────────► PayPal
POST /api/checkout/capture ─────► rate limit ──────────────────► service.captureCheckout
                                                                    └► paypal.captureOrder ► PayPal Sandbox
                                                                    └► paypal.verifyCapture
POST /api/checkout/cancel  ─────► rate limit ──────────────────► service.cancelCheckout
```

## Modules

| Module | Responsibility |
|---|---|
| `src/catalog.js` | The only source of experience ids, names, descriptions, locations, prices and currency. Prices are integer cents. Traveller validation (1–10) and price calculation. |
| `src/ai.js` | Builds the Gemini request (system instruction, JSON schema with id enum), calls the API, validates the reply against the catalogue, and discards model-written reasons that mention money. |
| `src/paypal.js` | OAuth, create order, capture, order read-back, and `verifyCapture` (exact two-decimal amount, currency, order id, capture id, `custom_id`, `reference_id`). Sandbox host is hard-coded. |
| `src/service.js` | The journey and the order state machine. Framework-free. |
| `src/security.js` | Security headers (CSP etc.) and fixed-window rate limiter. |
| `src/errors.js` | `AppError` (client-safe) and safe serialisation. |
| `server.js` | Express routes, JSON size limit, static files, centralised error handler. |

## Trust boundaries

- **Browser → server:** untrusted. Only an experience id, a traveller count, a free-text request and PayPal order ids are accepted. Any price, amount or currency field is ignored.
- **Gemini → server:** untrusted. Treated as a suggestion engine; output is parsed, schema-checked, and mapped onto catalogue records. It never sees prices.
- **PayPal → server:** trusted only after verification of the capture response against the server's own record.

## Order state machine

```
CREATED ──capture──► CAPTURING ──verified──► CONFIRMED   (repeat capture returns same confirmation)
   ▲                     │  ├─declined / not approved / transient error ─► back to CREATED (retryable)
   │                     │  ├─already captured at PayPal ─► order read back and verified (same checks)
   │                     │  └─2xx but unverifiable ─────────────────────► NEEDS_REVIEW (never confirmed)
   └── cancel ──► CANCELLED (capture refused)
```

`CAPTURING` blocks concurrent captures in-process; `PayPal-Request-Id` provides idempotency at PayPal for retries.

## Security controls

Environment-variable secrets; `.gitignore` excludes `.env`; server-side prices; id and quantity validation; AI response validation; `express.json({limit: '10kb'})`; rate limits (default 10 AI requests/min, 30 checkout requests/min per IP); headers: CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, HSTS; `textContent` rendering; error bodies never include stack traces or upstream messages; PayPal client has no production host.

**CSP note:** `script-src`, `frame-src` and `connect-src` allow only `'self'` plus the `paypal.com` and `paypalobjects.com` domain families (no inline script). The PayPal domains are listed as families rather than single hosts as a precaution, because the SDK loads resources from several subdomains. `style-src` includes `'unsafe-inline'` as a pragmatic allowance for styles injected by the PayPal SDK and Google Fonts. **None of this has been verified in a browser against the live SDK**; if the SDK works with a narrower policy, narrow it.

## API routes

`GET /api/health`, `GET /api/config`, `GET /api/catalog`, `POST /api/recommend`, `POST /api/checkout/create-order`, `POST /api/checkout/capture`, `POST /api/checkout/cancel`. Any other `/api/*` path returns a JSON 404. The front end calls `/api/config`, `/api/recommend` and the three `/api/checkout/*` routes; `/api/catalog` and `/api/health` are for inspection and the HTTP tests.

## Known design limits

In-memory order store and rate limiter (single process); no webhooks; no persistence; no email. These are appropriate for a demonstration and are listed in the README.
