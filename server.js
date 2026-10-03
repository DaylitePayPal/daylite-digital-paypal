'use strict';

/**
 * Daylite Digital — PayPal AI Hackathon 2026 demonstration server.
 * Thin Express layer over the service and integration modules.
 */

const path = require('node:path');

const express = require('express');

const { createService } = require('./service');

const { createPayPalClient } = require('./paypal');

const { securityHeaders, createRateLimiter } = require('./security');

const { AppError, toSafeBody } = require('./errors');

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
