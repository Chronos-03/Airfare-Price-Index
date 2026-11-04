'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Centralized application configuration.
 *
 * Every runtime value the system needs comes from here so that nothing is
 * hard-coded in scrapers, services or controllers.
 */
const config = {
  env: process.env.NODE_ENV || 'development',

  server: {
    port: parseInt(process.env.PORT, 10) || 5000
  },

  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/flight_fares',
    // Opt-in MongoDB persistence for the scrape pipeline. Off by default so
    // the JSON store remains the only writer unless MONGO_WRITE_ENABLED=true
    // (or the CLI --mongo flag is passed). The API server always connects so
    // it can read whatever has been written.
    enabled: process.env.MONGO_WRITE_ENABLED === 'true'
  },

  scraper: {
    timeout: parseInt(process.env.SCRAPER_TIMEOUT, 10) || 30000,
    maxRetries: parseInt(process.env.SCRAPER_MAX_RETRIES, 10) || 3,
    retryDelay: parseInt(process.env.SCRAPER_RETRY_DELAY, 10) || 2000,
    concurrency: parseInt(process.env.SCRAPER_CONCURRENCY, 10) || 2,
    requestDelay: parseInt(process.env.SCRAPER_REQUEST_DELAY, 10) || 1000
  },

  akasa: {
    // Akasa Air IBE API (observed on www.akasaair.com)
    baseUrl: process.env.AKASA_BASE_URL || 'https://prod-bl.qp.akasaair.com',
    deviceType: process.env.AKASA_DEVICE_TYPE || 'WEB',
    bookingType: process.env.AKASA_BOOKING_TYPE || 'BOOKING',
    userType: process.env.AKASA_USER_TYPE || 'GUEST',
    channel: process.env.AKASA_CHANNEL || 'WEB',
    currency: process.env.AKASA_CURRENCY || 'INR',
    maxConnections: parseInt(process.env.AKASA_MAX_CONNECTIONS, 10) || 8
  },

  dgca: {
    // DGCA monthly air traffic PDF (S3 key re-write + referer, see DgcaScraper)
    reportPeriod: process.env.DGCA_REPORT_PERIOD || '2026-04',
    reportUrl: process.env.DGCA_REPORT_URL // optional explicit URL override
  },

  outlier: {
    // Any total/base fare below this is treated as suspicious.
    minFare: parseFloat(process.env.OUTLIER_MIN_FARE) || 100,
    // Any total/base fare above this is treated as suspicious.
    maxFare: parseFloat(process.env.OUTLIER_MAX_FARE) || 100000,
    // Allowed relative difference between totalFare and the sum of known
    // components before a fare is flagged (0.2 = 20%).
    componentMismatchTolerance:
      parseFloat(process.env.OUTLIER_COMPONENT_MISMATCH_TOLERANCE) || 0.2,
    // Minimum absolute gap required for a component mismatch to be flagged
    // (avoids noisy flags on very small fares).
    minMismatchAbs: parseFloat(process.env.OUTLIER_MIN_MISMATCH_ABS) || 100
  },

  jsonExport: {
    // Enabled by default; set JSON_EXPORT_ENABLED=false to disable.
    enabled: process.env.JSON_EXPORT_ENABLED !== 'false',
    dir:
      process.env.JSON_EXPORT_DIR ||
      path.resolve(__dirname, '../../../output')
  },

  scheduler: {
    enabled: process.env.SCHEDULE_ENABLED === 'true',
    intervalHours: parseInt(process.env.SCHEDULE_INTERVAL_HOURS, 10) || 1
  },

  logging: {
    level: (process.env.LOG_LEVEL || 'info').toLowerCase()
  }
};

module.exports = config;