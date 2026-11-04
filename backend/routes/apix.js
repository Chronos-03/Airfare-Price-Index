'use strict';

const express = require('express');
const asyncHandler = require('../scraper/middleware/asyncHandler');
const {
  getApix,
  getDualIndex,
  getCapacityWeights,
  getHeatmap,
  getElasticity,
  getAirlines,
  getNsoExport,
  getBacktest,
  getSchedule,
  updateSchedule,
  getLogs,
  getFareComponents,
  getBasketWeights
} = require('../controllers/apixController');

const router = express.Router();

router.get('/apix', asyncHandler(getApix));
router.get('/apix/dual-index', asyncHandler(getDualIndex));
router.get('/capacity-weights', asyncHandler(getCapacityWeights));
router.get('/heatmap', asyncHandler(getHeatmap));
router.get('/elasticity', asyncHandler(getElasticity));
router.get('/airlines', asyncHandler(getAirlines));
router.get('/nso-export', asyncHandler(getNsoExport));
router.get('/backtest', asyncHandler(getBacktest));
router.get('/scrape/schedule', asyncHandler(getSchedule));
router.post('/scrape/schedule', asyncHandler(updateSchedule));
router.get('/scrape/logs', asyncHandler(getLogs));
router.get('/fare-components', asyncHandler(getFareComponents));
router.get('/basket-weights', asyncHandler(getBasketWeights));

module.exports = router;
