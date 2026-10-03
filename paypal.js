'use strict';

/**
 * PayPal Orders v2 integration — SANDBOX ONLY.
 *
 * - OAuth client-credentials token is obtained and cached on the server.
 * - The client secret never leaves this module / the server process.
 * - Orders are created with intent CAPTURE; the amount is computed by the caller
 *   from the server catalogue (see service.js), never from browser input.
 * - custom_id carries the Daylite booking reference for traceability and
 *   reference_id carries the catalogue experience id.
 * - PayPal-Request-Id headers make create/capture retries idempotent at PayPal.
 *
 * The base URL is fixed to the PayPal Sandbox. There is intentionally no switch
 * to production in this demonstration.
 */

const { AppError } = require('./errors');

const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';
const REQUEST_TIMEOUT_MS = 20000;

// Capture failures PayPal reports when the payer's funding source is refused.
const DECLINE_ISSUES = new Set([
  'INSTRUMENT_DECLINED',
  'TRANSACTION_REFUSED',
  'PAYER_CANNOT_PAY',
  'PAYER_ACCOUNT_RESTRICTED',
  'PAYER_ACCOUNT_LOCKED_OR_CLOSED',
  'TRANSACTION_LIMIT_EXCEEDED',
  'CREDIT_CARD_REFUSED',
]);

function createPayPalClient({ clientId, clientSecret, fetchImpl = globalThis.fetch, baseUrl = SANDBOX_BASE, now = Date.now } = {}) {
  let tokenCache = null; // { token, expiresAt }

  function isConfigured() {
    return Boolean(clientId && clientSecret);
  }

  function timeoutSignal() {
    return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
  }

  async function getAccessToken() {
    if (!isConfigured()) {
      throw new AppError(503, 'PAYPAL_NOT_CONFIGURED', 'PayPal Sandbox is not configured on this server.');
    }
    if (tokenCache && tokenCache.expiresAt > now() + 30000) return tokenCache.token;

    let res;
    try {
      res = await fetchImpl(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: timeoutSignal(),
      });
    } catch (_) {
      throw new AppError(502, 'PAYPAL_UNAVAILABLE', 'PayPal Sandbox is temporarily unavailable. Please try again.');
    }
    if (!res.ok) {
      throw new AppError(502, 'PAYPAL_AUTH_FAILED', 'Could not authenticate with PayPal Sandbox.');
    }
    let body;
    try {
      body = await res.json();
    } catch (_) {
      throw new AppError(502, 'PAYPAL_AUTH_FAILED', 'Could not authenticate with PayPal Sandbox.');
    }
    if (!body || typeof body.access_token !== 'string') {
      throw new AppError(502, 'PAYPAL_AUTH_FAILED', 'Could not authenticate with PayPal Sandbox.');
    }
    const ttl = Number(body.expires_in) > 0 ? Number(body.expires_in) * 1000 : 300000;
    tokenCache = { token: body.access_token, expiresAt: now() + ttl };
    return tokenCache.token;
  }

  async function api(path, { method = 'POST', body, requestId } = {}) {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: timeoutSignal(),
      });
    } catch (_) {
      throw new AppError(502, 'PAYPAL_UNAVAILABLE', 'PayPal Sandbox is temporarily unavailable. Please try again.');
    }
    let json = null;
    try {
      json = await res.json();
    } catch (_) {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  }

  /**
   * Create a Sandbox order for an amount already computed by the server.
   * @param {{experience: object, travellers: number, unitAmount: string, totalAmount: string, currency: string, bookingReference: string}} p
   */
  async function createOrder(p) {
    const { ok, json } = await api('/v2/checkout/orders', {
      requestId: `dld-create-${p.bookingReference}`,
      body: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: p.experience.id,
            custom_id: p.bookingReference,
            description: `Daylite Digital DEMO - ${p.experience.name}`.slice(0, 127),
            amount: {
              currency_code: p.currency,
              value: p.totalAmount,
              breakdown: { item_total: { currency_code: p.currency, value: p.totalAmount } },
            },
            items: [
              {
                name: p.experience.name.slice(0, 127),
                description: 'Demonstration experience (Sandbox, not a real reservation)',
                sku: p.experience.id,
                quantity: String(p.travellers),
                unit_amount: { currency_code: p.currency, value: p.unitAmount },
                category: 'DIGITAL_GOODS',
              },
            ],
          },
        ],
      },
    });
    if (!ok || !json || typeof json.id !== 'string' || !json.id) {
      throw new AppError(502, 'PAYPAL_ORDER_FAILED', 'Could not create the PayPal Sandbox order. Please try again.');
    }
    return { orderId: json.id, status: json.status };
  }

  /**
   * Capture an approved order. Resolves with the raw PayPal capture response, or
   * throws AppError(402, PAYMENT_DECLINED) / AppError(409, ORDER_NOT_APPROVED) / AppError(502, ...).
   */
  async function captureOrder(orderId) {
    const { ok, status, json } = await api(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      requestId: `dld-capture-${orderId}`,
      body: {},
    });
    if (ok) return json;

    const issues = json && Array.isArray(json.details) ? json.details.map((d) => d && d.issue).filter(Boolean) : [];
    if (issues.some((i) => DECLINE_ISSUES.has(i))) {
      throw new AppError(402, 'PAYMENT_DECLINED', 'The payment was declined. Please try a different PayPal payment method.');
    }
    if (issues.includes('ORDER_NOT_APPROVED') || issues.includes('PAYER_ACTION_REQUIRED')) {
      throw new AppError(409, 'ORDER_NOT_APPROVED', 'The order has not been approved in PayPal yet.');
    }
    if (issues.includes('ORDER_ALREADY_CAPTURED')) {
      throw new AppError(409, 'ORDER_ALREADY_CAPTURED', 'This order has already been captured.');
    }
    throw new AppError(502, 'PAYPAL_CAPTURE_FAILED', 'PayPal could not complete the capture. No confirmation was issued.', undefined, `upstream_status_${status}`);
  }

  /**
   * Read an order back from PayPal (GET /v2/checkout/orders/{id}). Used only to recover when a
   * capture already happened (e.g. the browser retried after a dropped response); the result is
   * passed through verifyCapture exactly like a fresh capture response.
   */
  async function getOrder(orderId) {
    const { ok, json } = await api(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
    if (!ok || !json) {
      throw new AppError(502, 'PAYPAL_CAPTURE_FAILED', 'PayPal could not complete the capture. No confirmation was issued.');
    }
    return json;
  }

  return { isConfigured, getAccessToken, createOrder, captureOrder, getOrder };
}

/**
 * Verify a PayPal capture response against what the server expected.
 * Fails closed: any missing or mismatching field throws and no confirmation is produced.
 * @returns {{captureId: string, captureStatus: string, amount: string, currency: string}}
 */
function toCents(decimalString) {
  const [whole, frac = ''] = String(decimalString).split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

function verifyCapture(response, expected) {
  const fail = (why) => new AppError(502, 'CAPTURE_UNVERIFIED', 'The payment could not be verified, so no confirmation was issued.', undefined, why);

  if (!response || typeof response !== 'object') throw fail('missing_response');
  if (response.id !== expected.orderId) throw fail('order_id_mismatch');
  if (response.status !== 'COMPLETED') throw fail('order_not_completed');

  const unit = Array.isArray(response.purchase_units) ? response.purchase_units[0] : null;
  if (!unit) throw fail('missing_purchase_unit');
  const capture = unit.payments && Array.isArray(unit.payments.captures) ? unit.payments.captures[0] : null;
  if (!capture) throw fail('missing_capture');
  if (typeof capture.id !== 'string' || !capture.id) throw fail('missing_capture_id');
  if (capture.status !== 'COMPLETED') throw fail('capture_not_completed');
  if (!capture.amount || typeof capture.amount.value !== 'string' || typeof capture.amount.currency_code !== 'string') {
    throw fail('missing_amount');
  }
  if (capture.amount.currency_code !== expected.currency) throw fail('currency_mismatch');
  if (!/^\d+(\.\d{1,2})?$/.test(capture.amount.value) || toCents(capture.amount.value) !== toCents(expected.amount)) {
    throw fail('amount_mismatch');
  }
  // Traceability: PayPal echoes custom_id/reference_id on the purchase unit and/or capture.
  const customId = capture.custom_id || unit.custom_id;
  if (customId !== expected.bookingReference) throw fail('custom_id_mismatch');
  if (unit.reference_id !== expected.experienceId) throw fail('reference_id_mismatch');

  return {
    captureId: capture.id,
    captureStatus: capture.status,
    amount: capture.amount.value,
    currency: capture.amount.currency_code,
  };
}

module.exports = { createPayPalClient, verifyCapture, SANDBOX_BASE };
