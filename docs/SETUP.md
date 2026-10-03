# Setup

## Prerequisites

* Node.js **20.12+** and npm
* A PayPal Developer account with a **Sandbox** REST app (Client ID + secret) and a Sandbox *personal* test buyer
* A Google AI Studio API key for Gemini

## Install and run

```bash
npm install
cp .env.example .env
# edit .env: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, GEMINI_API_KEY (optionally GEMINI_MODEL)
npm start
```

Open http://localhost:3000. The page shows a warning if either service is not configured. This snapshot does not include `package-lock.json` because it was prepared without npm registry access. `npm install` generates it; commit it.

## Automated tests

```bash
npm test
```

No credentials or network are needed. `flow.test.js` runs without dependencies. `http.test.js` starts the real Express app and runs after `npm install`; without Express it is reported as skipped.

## Live PayPal Sandbox checklist (manual)

Run these yourself with real Sandbox credentials. **Record results honestly; do not mark an item done unless you ran it.**

* [ ] `npm install`, then `npm test`: confirm the HTTP-layer tests run (not skipped) and pass.
* [ ] Check the current Gemini model name in Google's documentation and set `GEMINI_MODEL` if the default is no longer valid.
* [ ] Start the server with valid Sandbox credentials; confirm no errors at start-up.
* [ ] Open the browser console on the page: no CSP violations and no failed requests; the PayPal buttons render.
* [ ] Enter a request; confirm 1–3 catalogue recommendations appear.
* [ ] Select an experience, set travellers to 2, continue to PayPal.
* [ ] Approve with a Sandbox personal account; confirm the confirmation screen shows booking reference, amount, PayPal order ID and capture ID.
* [ ] In the Sandbox dashboard, confirm the order's `custom_id` equals the booking reference and the amount matches.
* [ ] Close the PayPal popup before approving; confirm the cancellation message and that no capture exists.
* [ ] Simulate a declined payment using PayPal's Sandbox negative-testing tools; confirm a decline message and no confirmation.
* [ ] Reload and try to capture the same order again; confirm no second capture.

### Status of verification for this repository snapshot

The offline checks used Node v22.22.2 and npm 10.9.7 in an environment with no access to the npm registry, PayPal or Google, and no credentials. See "Verification status" in the README for the full three-state breakdown. In short:

* **Verified (executed):** syntax checks on all JavaScript files; `node --test` gives 41 tests, 32 passed, 0 failed, 9 skipped.
* **Implemented / offline-tested:** pricing, validation, PayPal create/capture/verify/cancel/decline logic and Gemini output validation, against fakes.
* **Not runtime-verified:** `package-lock.json` could not be generated in this environment because npm registry access is blocked; Express start-up and the 9 HTTP tests; the browser journey; live Gemini; PayPal Sandbox. Work through the checklist above on an npm-enabled machine.

## Troubleshooting

| Symptom                           | Likely cause                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| Banner: "Server setup incomplete" | Missing `.env` values                                                                       |
| `AI_UNAVAILABLE`                  | Bad key, wrong `GEMINI_MODEL`, or quota                                                     |
| `PAYPAL_AUTH_FAILED`              | Wrong Sandbox Client ID/secret, or live credentials used with the Sandbox host              |
| PayPal buttons missing            | Blocked SDK script or browser extension; check the console and CSP                          |
| `package-lock.json` missing       | Run `npm install` on a machine with npm registry access, then commit the generated lockfile |
