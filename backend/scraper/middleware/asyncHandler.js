'use strict';

/**
 * Wraps an async route handler so rejected promises reach the central error
 * middleware instead of crashing the process.
 */
function asyncHandler(fn) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;