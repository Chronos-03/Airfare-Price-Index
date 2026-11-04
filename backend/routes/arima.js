'use strict';

const express = require('express');
const asyncHandler = require('../scraper/middleware/asyncHandler');
const {
  getArimaForecast,
  getSurgeAlerts,
  getOutageRisks,
  getForecastSummary
} = require('../controllers/arimaController');

const router = express.Router();

router.get('/forecast/arima', asyncHandler(getArimaForecast));
router.get('/forecast/surges', asyncHandler(getSurgeAlerts));
router.get('/forecast/outages', asyncHandler(getOutageRisks));
router.get('/forecast/summary', asyncHandler(getForecastSummary));

module.exports = router;
