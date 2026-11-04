'use strict';

const mongoose = require('mongoose');
const config = require('./index');
const logger = require('../utils/logger');

/**
 * Establish a connection to MongoDB using the configured MONGODB_URI.
 *
 * For automated tests that exercise persistence, point MONGODB_URI at a
 * local/dev MongoDB instance (or something like mongodb-memory-server in
 * your own test harness). This project's core unit tests avoid touching a
 * database entirely by stubbing the storage layer.
 *
 * @param {object} [options]
 * @param {number} [options.retries=3]
 * @param {number} [options.delayMs=2000]
 * @param {number} [options.timeoutMs=30000]
 * @returns {Promise<mongoose.Connection>}
 */
let cachedConnPromise = null;

async function connectDatabase(options = {}) {
  const isVercel = Boolean(process.env.VERCEL);
  const { retries = isVercel ? 1 : 3, delayMs = 1000, timeoutMs = isVercel ? 8000 : 30000 } = options;

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (mongoose.connection.readyState === 2 && cachedConnPromise) {
    return cachedConnPromise;
  }

  const uri = config.database.uri || process.env.MONGODB_URI;
  if (!uri) {
    logger.warn('No MONGODB_URI found in configuration');
    return null;
  }

  cachedConnPromise = (async () => {
    let attempt = 0;
    while (attempt <= retries) {
      try {
        logger.debug(`Connecting to MongoDB (attempt ${attempt + 1})...`);
        await mongoose.connect(uri, {
          serverSelectionTimeoutMS: timeoutMs,
          maxPoolSize: isVercel ? 5 : 10
        });
        logger.info('MongoDB connected successfully');
        return mongoose.connection;
      } catch (err) {
        attempt += 1;
        if (attempt > retries) {
          logger.error('MongoDB connection failed after retries:', err.message);
          cachedConnPromise = null;
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    cachedConnPromise = null;
    throw new Error('Unable to connect to MongoDB');
  })();

  return cachedConnPromise;
}

/**
 * Disconnect from MongoDB.
 */
async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.debug('MongoDB disconnected');
  }
}

module.exports = { connectDatabase, disconnectDatabase };