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
