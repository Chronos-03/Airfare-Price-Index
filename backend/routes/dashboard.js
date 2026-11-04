'use strict';

const express = require('express');
const asyncHandler = require('../scraper/middleware/asyncHandler');
const { getStats, getMeta } = require('../controllers/dashboardController');

const router = express.Router();

// GET /api/stats - aggregated dashboard data computed from the fares collection
router.get('/stats', asyncHandler(getStats));

// GET /api/meta - filter metadata (full origin/destination/airline/travel-date lists)
router.get('/meta', asyncHandler(getMeta));

module.exports = router;
