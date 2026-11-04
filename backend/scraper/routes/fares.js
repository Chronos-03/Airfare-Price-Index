'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const controller = require('../controllers/fareController');

const router = express.Router();

router.get('/api', controller.getIndex);
router.get('/api/health', asyncHandler(controller.getHealth));
router.post('/api/scrape', asyncHandler(controller.scrape));

router.get('/api/fares/analytics', asyncHandler(controller.getFaresAnalytics));
router.get('/api/fares/route/:origin/:destination', asyncHandler(controller.getRouteFares));
router.get('/api/fares/:id', asyncHandler(controller.getFare));
router.get('/api/fares', asyncHandler(controller.listFares));
router.post('/api/fares/bulk', asyncHandler(controller.bulkInsertFares));

router.get('/api/scrape/mesh/status', asyncHandler(controller.getMeshStatusController));
router.get('/api/scrape/queue/status', asyncHandler(controller.getQueueStatusController));
router.post('/api/scrape/queue/dispatch', asyncHandler(controller.dispatchQueueJobController));

module.exports = router;