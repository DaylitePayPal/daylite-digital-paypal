'use strict';

/**
 * Error type whose message is always safe to show to a client.
 * Anything that is not an AppError is reported as a generic 500.
 */
class AppError extends Error {
  constructor(status, code, message, extra, detail) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.extra = extra || undefined;
    this.detail = detail || undefined; // server-side diagnostics only; never serialised to clients
  }
}

function toSafeBody(err) {
  if (err instanceof AppError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, ...(err.extra || {}) } } };
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } },
  };
}

module.exports = { AppError, toSafeBody };
