'use strict';

/**
 * HTTP-layer tests for the real Express app (server.js).
 *
 * They start createApp() on an ephemeral port and talk to it over real HTTP with
 * fetch. PayPal and Gemini are still replaced by in-process fake `fetch`
 * implementations, so no credentials or outbound network are needed. These tests
 * therefore verify Express wiring, middleware and routes, NOT the live PayPal
 * Sandbox or the live Gemini API.
 *
 * They require Express (`npm install`). If it is not installed they are reported as
 * skipped, never as passed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

let createApp = null;
let skipReason = false;
try {
  require.resolve('express');
  ({ createApp } = require('./server'));
} catch (err) {
  skipReason = 'express is not installed (run `npm install`)';
}

const catalog = require('./catalog');
const { createService } = require('./service');
const { createPayPalClient } = require('./paypal');

const SECRETS = ['SUPER-SECRET-PAYPAL', 'GEMINI-SECRET-KEY', 'fake-paypal-access-token'];
