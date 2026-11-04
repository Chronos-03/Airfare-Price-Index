'use strict';

const logger = require('../utils/logger');

/**
 * Central error handler. Logs the error (with full detail in
 * non-production) and returns a consistent JSON error body.
 *
 * NEVER exposes stack traces or internal details in production responses.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const body = {
    error: {
      message: status === 500 ? 'Internal server error' : err.message,
      status
    }
  };

  if (process.env.NODE_ENV !== 'production') {
    body.error.detail = err.message;
    if (err.stack) body.error.stack = err.stack;
  }

  logger.error('Request failed', {
    method: req.method,
    path: req.originalUrl,
    status,
    error: err.message
  });

  res.status(status).json(body);
}

/**
 * 404 for unmatched routes.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: { message: `Route not found: ${req.method} ${req.originalUrl}`, status: 404 }
  });
}

module.exports = { errorHandler, notFoundHandler };