'use strict';

/**
 * Daylite Digital demonstration workflow.
 *
 *   recommend -> createCheckout -> (PayPal approval in browser) -> captureCheckout -> confirmation
 *
 * Framework-free so the whole journey can be tested offline with stubbed
 * PayPal and Gemini clients. server.js is a thin HTTP layer over this module.
 */

const crypto = require('node:crypto');
const catalog = require('./catalog');
const ai = require('./ai');
const paypal = require('./paypal');
const { AppError } = require('./errors');

const MAX_STORED_ORDERS = 5000;
const DEMO_NOTICE =
  'Demonstration only: Sandbox payment, demonstration catalogue, no live inventory, no real reservation, no production payment processing.';

function defaultReference() {
  return `DLD-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

/**
 * @param {{
 *   paypalClient: ReturnType<typeof paypal.createPayPalClient>,
 *   gemini?: {apiKey?: string, model?: string, fetchImpl?: Function},
 *   now?: () => Date,
 *   newReference?: () => string,
 *   store?: Map<string, object>
 * }} deps
 */
function createService(deps) {
  const { paypalClient, gemini = {}, now = () => new Date(), newReference = defaultReference } = deps;
  const orders = deps.store || new Map(); // key: PayPal order id

  function remember(record) {
    if (orders.size >= MAX_STORED_ORDERS) {
      orders.delete(orders.keys().next().value); // evict oldest
    }
    orders.set(record.orderId, record);
  }

  function requireOrder(orderId) {
    if (typeof orderId !== 'string' || !/^[A-Za-z0-9-]{5,64}$/.test(orderId)) {
      throw new AppError(400, 'INVALID_ORDER_ID', 'Invalid order reference.');
    }
    const record = orders.get(orderId);
    if (!record) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    return record;
  }

  function confirmationFor(record) {
    return {
      demonstration: true,
      notice: DEMO_NOTICE,
      status: 'CONFIRMED',
      bookingReference: record.bookingReference,
      experience: {
        id: record.experience.id,
        name: record.experience.name,
        location: record.experience.location,
      },
      travellers: record.travellers,
      amount: record.amount,
      currency: record.currency,
      paypalOrderId: record.orderId,
      paypalCaptureId: record.captureId,
      confirmedAt: record.confirmedAt,
    };
  }

  /** Step 2: natural language -> validated catalogue recommendations. */
  async function recommend(query) {
    const { recommendations, model } = await ai.recommend(query, gemini);
    return { demonstration: true, model, recommendations };
  }

  /** Step 4a: server computes the price and creates a Sandbox order. */
  async function createCheckout(input) {
    const body = input && typeof input === 'object' ? input : {};
    if (!catalog.getExperience(body.experienceId)) {
      throw new AppError(400, 'INVALID_EXPERIENCE', 'Unknown experience.');
    }
    if (catalog.parseTravellers(body.travellers) === null) {
      throw new AppError(
        400,
        'INVALID_TRAVELLERS',
        `Travellers must be a whole number from ${catalog.MIN_TRAVELLERS} to ${catalog.MAX_TRAVELLERS}.`
      );
    }
    // Any price/amount fields in the request are ignored; only catalogue data is used.
    const total = catalog.calculateTotal(body.experienceId, body.travellers);
    const bookingReference = newReference();

    const order = await paypalClient.createOrder({
      experience: total.experience,
      travellers: total.travellers,
      unitAmount: total.unitAmount,
      totalAmount: total.totalAmount,
      currency: total.currency,
      bookingReference,
    });

    remember({
      orderId: order.orderId,
      bookingReference,
      experience: total.experience,
      travellers: total.travellers,
      amount: total.totalAmount,
      currency: total.currency,
      state: 'CREATED',
      createdAt: now().toISOString(),
    });

    return {
      demonstration: true,
      orderId: order.orderId,
      bookingReference,
      experienceId: total.experience.id,
      travellers: total.travellers,
      amount: total.totalAmount,
      currency: total.currency,
    };
  }

  /** Step 5: capture, verify, and only then confirm. */
  async function captureCheckout(input) {
    const body = input && typeof input === 'object' ? input : {};
    const record = requireOrder(body.orderId);

    if (record.state === 'CONFIRMED') return confirmationFor(record); // idempotent: never capture twice
    if (record.state === 'CAPTURING') throw new AppError(409, 'CAPTURE_IN_PROGRESS', 'This payment is already being processed.');
    if (record.state === 'CANCELLED') throw new AppError(409, 'ORDER_CANCELLED', 'This order was cancelled.');
    if (record.state === 'NEEDS_REVIEW') {
      throw new AppError(409, 'ORDER_NEEDS_REVIEW', 'This payment could not be verified automatically and was not confirmed.');
    }

    record.state = 'CAPTURING';
    let response;
    try {
      response = await paypalClient.captureOrder(record.orderId);
    } catch (err) {
      if (err instanceof AppError && err.code === 'ORDER_ALREADY_CAPTURED' && typeof paypalClient.getOrder === 'function') {
        // PayPal already captured this order (for example a dropped response). Read it back; it is
        // still verified field by field below, so nothing is confirmed on trust.
        try {
          response = await paypalClient.getOrder(record.orderId);
        } catch (readErr) {
          record.state = 'CREATED';
          throw readErr;
        }
      } else {
        // Declines and not-approved orders can be retried; so can transient failures
        // (PayPal-Request-Id makes the retry idempotent at PayPal).
        record.state = 'CREATED';
        throw err;
      }
    }

    let verified;
    try {
      verified = paypal.verifyCapture(response, {
        orderId: record.orderId,
        amount: record.amount,
        currency: record.currency,
        bookingReference: record.bookingReference,
        experienceId: record.experience.id,
      });
    } catch (err) {
      // PayPal answered 2xx but we cannot prove the payment matches. Fail closed.
      record.state = 'NEEDS_REVIEW';
      throw err;
    }

    record.state = 'CONFIRMED';
    record.captureId = verified.captureId;
    record.confirmedAt = now().toISOString();
    return confirmationFor(record);
  }

  /** The payer closed the PayPal window. */
  function cancelCheckout(input) {
    const body = input && typeof input === 'object' ? input : {};
    const record = requireOrder(body.orderId);
    if (record.state === 'CONFIRMED') throw new AppError(409, 'ORDER_ALREADY_CONFIRMED', 'This order is already confirmed.');
    if (record.state === 'CAPTURING') throw new AppError(409, 'CAPTURE_IN_PROGRESS', 'This payment is already being processed.');
    record.state = 'CANCELLED';
    return { demonstration: true, status: 'CANCELLED', bookingReference: record.bookingReference, message: 'Payment cancelled. You have not been charged.' };
  }

  function publicConfig(env = {}) {
    return {
      demonstration: true,
      notice: DEMO_NOTICE,
      paypalClientId: env.paypalClientId || null, // public Client ID only
      paypalConfigured: paypalClient.isConfigured(),
      aiConfigured: Boolean(gemini.apiKey && gemini.model),
      currency: catalog.CURRENCY,
      maxTravellers: catalog.MAX_TRAVELLERS,
      minTravellers: catalog.MIN_TRAVELLERS,
    };
  }

  return { recommend, createCheckout, captureCheckout, cancelCheckout, publicConfig, _orders: orders };
}

module.exports = { createService, DEMO_NOTICE };
