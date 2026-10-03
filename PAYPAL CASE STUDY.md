# Daylite Digital — AI discovery to PayPal Sandbox checkout

*Submission to the **PayPal AI Hackathon 2026***

**Made in Africa, a proudly Namibian service.**

A working demonstration for the **PayPal AI Hackathon 2026**. A traveller describes a trip in plain language, **Google Gemini** matches it to a controlled demonstration catalogue, the **server** (not the AI, not the browser) calculates the price, and the traveller pays through **PayPal Sandbox**. The server then captures the payment, verifies it against its own record, and only then shows a demonstration confirmation.

```
Discover → AI recommendation → Select experience → Traveller quantity → PayPal Sandbox → Confirmation
```

> **Demonstration only.** The catalogue is demonstration data. PayPal runs in **Sandbox**. There is **no live inventory connection**, **no real reservations** and **no production payment processing**.

## At a glance

| | |
|---|---|
| **What it is** | Daylite Digital is a digital business solution developed by **Southern Cross Stars Investments CC**, a member of **Southern Cross Stars Group**. This repository is a standalone Node/Express demonstration of its AI-assisted discovery and checkout flow. |
| **Use case** | People often know the *feeling* they want ("a coastal escape, two days") before they know the destination. They can say that in their own words and move straight into a payment flow whose price they can trust. |
| **Why payments matter here** | Small digital businesses in African markets need payment infrastructure that is accessible and reliable. The design keeps payment logic small, server-side and auditable. See [`docs/PAYPAL_CASE_STUDY.md`](docs/PAYPAL_CASE_STUDY.md). |
| **AI** | Google Gemini, called only from the server, returns schema-constrained JSON that is validated against the catalogue. |
| **PayPal** | Orders v2 REST API (Sandbox host only) plus the PayPal JavaScript SDK Buttons. |

## The journey

| Step | What happens |
|---|---|
| 1 Discover | The traveller types a request, e.g. "I want a cultural experience in Osaka." |
| 2 AI recommendation | The server asks Gemini. One to three validated catalogue matches are shown, each with a short reason. |
| 3 Select experience, 4 traveller quantity | The traveller picks one experience and 1–10 travellers. A total is previewed and is recalculated on the server. |
| 5 PayPal | The server creates a Sandbox order with the server-calculated amount. The traveller approves it in PayPal. |
| 6 Confirmation | The server captures and verifies the payment. The screen shows the demonstration booking reference, experience, travellers, amount, currency, PayPal order ID and PayPal capture ID, clearly labelled as a demonstration. |

## Why the catalogue mixes Namibia with New York, Paris and elsewhere

The catalogue contains Namibian experiences (Sossusvlei, Lüderitz) next to Cape Town, Osaka, New York and Paris. **The catalogue demonstrates that the same Daylite Digital architecture can represent Namibian and international destinations. The catalogue entries are demonstration data and do not represent live inventory or live international operations.**

The point is architectural: the same catalogue, AI-matching, server-side pricing and PayPal checkout code represents a destination in Namibia and a destination elsewhere in exactly the same way. A digital business built in Namibia can build technology that is capable of serving users and representing destinations beyond Namibia.

## How Gemini is used

- Gemini is called **only from the server** (`src/ai.js`); the API key never reaches the browser.
- It receives the traveller's request and a catalogue summary **without prices**, and must reply with structured JSON (`responseMimeType: application/json` and a `responseSchema` in which `experienceId` is an enum of catalogue ids).
- Gemini is a **matcher, not an author**. It cannot create experiences or catalogue ids, set a price or currency, or change the payable amount.
- Every reply is **validated against the catalogue**: unknown ids are dropped, duplicates removed, results capped at three, and all displayed facts (name, location, description, price, currency) are re-read from the server catalogue.
- The model's one-sentence "why it matches" is the only AI-written text shown. If it mentions money (a currency symbol or name, "price", "cost", "cheap", a percentage, "per person" and similar), the server discards it and shows a neutral sentence instead.
- The model is set with `GEMINI_MODEL`. No model-specific request fields are sent, so changing the model needs no code change. The traveller's text is treated as untrusted data.

## How PayPal is used

Implemented in `src/paypal.js` against the **PayPal Orders v2 REST API on the Sandbox host only**, with the PayPal JS SDK Buttons in the browser.

1. **OAuth** client-credentials token, fetched and cached on the server. The browser receives only the public Client ID, which the SDK needs.
2. **Create order** (`POST /v2/checkout/orders`, `intent: CAPTURE`) with an amount computed from the catalogue. `reference_id` is the experience id, `custom_id` is the Daylite booking reference, and `PayPal-Request-Id` makes retries idempotent. The item category is `DIGITAL_GOODS` (one of the Orders v2 item categories), because the demonstration delivers an electronic confirmation and nothing physical.
3. **Approval** by the payer in PayPal.
4. **Capture** (`POST /v2/checkout/orders/{id}/capture`) from the server.
5. **Verification** (`verifyCapture`): order id, `COMPLETED` status, capture id present, exact captured amount and currency, `custom_id` and `reference_id` all match the server's record. Any mismatch or missing field **fails closed**: no confirmation is issued.
6. **Edge cases:** declined payments (HTTP 402, retryable), cancellation, duplicate and concurrent capture protection, orders not yet approved, and orders PayPal reports as already captured (read back with `GET /v2/checkout/orders/{id}` and verified the same way).

## API routes

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Liveness check |
| `GET /api/config` | Public configuration: PayPal Client ID (public), whether PayPal and Gemini are configured, currency |
| `GET /api/catalog` | The demonstration catalogue with server prices |
| `POST /api/recommend` | Gemini recommendation, validated against the catalogue |
| `POST /api/checkout/create-order` | Server-priced PayPal Sandbox order |
| `POST /api/checkout/capture` | Server-side capture, verification and confirmation |
| `POST /api/checkout/cancel` | Records a cancellation |

## Architecture

A static front end (`public/`) calls a thin Express layer (`server.js`) over framework-free modules in `src/` (`catalog`, `ai`, `paypal`, `service`, `security`, `errors`). The business logic does not depend on Express, so the whole journey is testable offline with fake `fetch` implementations. Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Run it

Requires **Node.js 20.12 or newer**. You need two free credentials of your own; none are included in this repository.

1. **PayPal Sandbox:** in the [PayPal Developer Dashboard](https://developer.paypal.com/) create a Sandbox REST app and copy its **Client ID** and **Secret**. The dashboard also provides Sandbox *personal* test accounts; use one to approve payments. No real money moves.
2. **Gemini:** create an API key in [Google AI Studio](https://aistudio.google.com/apikey).

```bash
npm install
cp .env.example .env     # then fill in your own values
npm start                # http://localhost:3000
```

| Variable | Purpose |
|---|---|
| `PAYPAL_CLIENT_ID` | Sandbox REST app Client ID (also given to the browser for the SDK) |
| `PAYPAL_CLIENT_SECRET` | Sandbox secret, server only |
| `GEMINI_API_KEY` | Google AI Studio key, server only |
| `GEMINI_MODEL` | Gemini model name. Default `gemini-3.1-flash-lite`, a model for which Google's documentation lists structured-output support. It is configurable: set another model name here if you prefer or if Google renames it |
| `PORT` | Default 3000 |
| `TRUST_PROXY` | `1` only behind a trusted reverse proxy |
| `AI_RATE_LIMIT_PER_MINUTE`, `CHECKOUT_RATE_LIMIT_PER_MINUTE` | Optional limits |

If either service is not configured, the page shows a setup warning. More detail, including a live Sandbox checklist and troubleshooting, is in [`docs/SETUP.md`](docs/SETUP.md).

## Tests

```bash
npm test
```

Two test files, both using `node:test`:

- `test/flow.test.js` — **32 offline tests**, no dependencies. PayPal and Gemini are replaced by in-process fakes. They cover valid and invalid AI output, catalogue validation, AI reasons that mention money, the configurable model, server-side pricing, the order payload and item category, capture, declines, cancellation, already-captured recovery, strict amount verification, missing confirmation data, `custom_id` traceability, invalid traveller counts and ids, duplicate capture, rate limiting, headers and secret hygiene.
- `test/http.test.js` — **9 HTTP-layer tests** that start the real Express app on an ephemeral port: health, config and static files with security headers; the catalogue; AI recommendation (valid, invalid, malformed JSON, upstream failure); invalid catalogue id and traveller counts; server-calculated pricing with browser price fields ignored; capture, verification and duplicate capture; a mismatched capture; cancellation; request-size limit; unknown routes; rate limiting; and no secrets in any response. PayPal and Gemini are still fakes. These tests need Express, so **without `npm install` they are reported as skipped, not passed.**

Tests are not live verification: they show the code behaves correctly against fakes of the documented API shapes, not against live PayPal Sandbox or live Gemini.

## Verification status

Three states are used, and "verified" is reserved for things that were actually executed. The offline checks were run with Node v22.22.2 and npm 10.9.7 in an environment with no access to the npm registry, PayPal or Google, and with no credentials.

**VERIFIED** (executed successfully in that environment)

- `node --check` passes on all 10 JavaScript files (`server.js`, six `src/` modules, `public/app.js`, both test files).
- `node --test`: 41 tests, **32 passed, 0 failed, 9 skipped**. The 9 skipped are the HTTP tests, which skip because Express could not be installed there. Skipped tests are not counted as passed.
- Repository scans: no secret patterns, no `.env`, no `node_modules`, no archives, no broken Markdown links, no stale slogans or company names.

**IMPLEMENTED / OFFLINE-TESTED** (behaviour checked by the 32 offline tests against in-process fakes, without contacting PayPal or Google)

- Server-authoritative pricing; catalogue-id, quantity and AI-output validation; AI reasons that mention money are discarded; configurable `GEMINI_MODEL`.
- PayPal order creation (item category `DIGITAL_GOODS`), exact capture verification, duplicate capture protection, already-captured recovery, cancellation and decline handling.
- Security headers, request-size limit and rate-limit logic.

**NOT RUNTIME-VERIFIED**

- `package-lock.json` could not be generated in this environment because npm registry access is blocked. Run `npm install` and commit the result.
- Express installation and server start-up, and the 9 HTTP tests in `test/http.test.js` (written, not executed).
- The browser journey, PayPal SDK loading and the Content-Security-Policy in a real browser.
- Live Gemini runtime verification was not possible in this environment because external API access is blocked.
- PayPal Sandbox runtime verification was not possible in this environment because external network access and credentials were unavailable.
- The PayPal request shape was not re-checked against current PayPal documentation.

## Security

Secrets live in environment variables only (`.env` is git-ignored). The PayPal secret and Gemini key stay on the server. Prices are server-side. Catalogue ids, traveller counts and AI output are validated. Request bodies are limited to 10 KB. Requests are rate limited per IP (stricter for AI). Security headers include a Content-Security-Policy that limits script, frame and connect sources to the site itself and PayPal domains. Dynamic text is rendered with `textContent`. Error bodies never include stack traces or upstream detail. The PayPal client has no production host. See `docs/ARCHITECTURE.md`.

## Live technology versus demonstration data

| Part | Status |
|---|---|
| Express server, routes, validation, rate limiting, security headers | Real code. Not yet run end to end; see Verification status |
| Gemini request/response handling and catalogue validation | Real code that calls the real Gemini API when you supply a key. Not yet verified live |
| PayPal Orders v2 create/capture/verify | Real code that calls the **PayPal Sandbox** when you supply Sandbox credentials. Not yet verified live |
| Catalogue (Namibia, Cape Town, Osaka, New York, Paris), descriptions and prices | **Demonstration data.** Not live inventory, not live listings, not real prices |
| Payments | **Sandbox only.** No real money, no production payment processing |
| Bookings and the booking reference | **Demonstration.** No real reservation exists |
| Destinations outside Namibia | **Demonstration entries only.** Daylite Digital does not claim live inventory or live operations there |

## Demonstration limits

- Demonstration catalogue and prices; no live inventory; no real reservations.
- PayPal **Sandbox** only; no production payments. No claim is made about PayPal merchant availability in any country.
- Order records are held **in memory** and are lost on restart; a real system would use a database and PayPal webhooks.
- Rate limiting is per process. Confirmations are not emailed.

## What was built for the PayPal AI Hackathon 2026, and what is preserved

The standalone Node/Express application, the Gemini integration, the PayPal Sandbox integration, the tests and the documentation in this repository were created for the PayPal AI Hackathon 2026. The application **runs independently and needs nothing from `storefront/`**.

Daylite Digital previously existed as a Shopify storefront built on Shopify's **Atelier** theme. **The Atelier theme code is not included in this repository**, because its redistribution terms could not be established and it is not needed. `storefront/` keeps only material that is Daylite's own and clearly separable from the theme: the Daylite accommodation-provider styling and form behaviour (two Liquid snippets), the Daylite colour and type choices, and home-page wording rewritten for this submission. See [`storefront/README.md`](storefront/README.md) and [`docs/THIRD_PARTY_NOTICES.md`](docs/THIRD_PARTY_NOTICES.md).

## Repository structure

```
.env.example            placeholders only
.gitignore
LICENSE                 MIT (application code)
README.md
package.json
server.js               Express wiring, static files, safe error handling
docs/
  ARCHITECTURE.md
  PAYPAL_CASE_STUDY.md
  SETUP.md
  THIRD_PARTY_NOTICES.md
public/
  index.html            the interface
  app.js                browser logic (textContent only, no secrets)
  styles.css            Daylite forest-green and gold palette
src/
  ai.js                 Gemini request and response validation
  catalog.js            server-controlled demonstration catalogue and pricing
  errors.js             safe error type
  paypal.js             PayPal Sandbox client and capture verification
  security.js           security headers and rate limiter
  service.js            journey logic: recommend / create / capture / cancel
test/
  flow.test.js          32 offline tests
  http.test.js          9 HTTP-layer tests (need `npm install`)
storefront/
  README.md             what is kept, what is not, and why
  daylite-storefront-copy.md   home-page wording rewritten for this submission
  snippets/
    accomo-provider-styles.liquid          Daylite provider-page styling (CSS only)
    provider-application-overrides.liquid  Daylite provider-application form behaviour
```

`package-lock.json` will sit next to `package.json` once generated by `npm install`.

## Technologies

Node.js, Express, PayPal Orders v2 and JavaScript SDK, Google Gemini REST API, vanilla JavaScript and CSS, `node:test`. Fonts: Cormorant Garamond and Inter via Google Fonts.

## About and licence

Daylite Digital is developed by Southern Cross Stars Investments CC, a member of Southern Cross Stars Group. The founder is a digital business solution developer & entrepreneur.

Everything in this repository is released under the [MIT licence](LICENSE). No Shopify or Atelier theme code is included, and nothing here claims ownership of Shopify's theme. Third-party components and services are listed in `docs/THIRD_PARTY_NOTICES.md`.

**Contact (Daylite Digital business contact):** support@daylitedigital.com · +264 81 741 7515 (WhatsApp).
