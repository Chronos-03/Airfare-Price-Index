const express = require('express');
const router = express.Router();

// GET /api
// Placeholder root for future API routes.
router.get('/', (req, res) => {
  res.json({ service: 'airfare-index', message: 'API root - not yet implemented' });
});

// Future business endpoints (Phase 2+) will be registered here, for example:
// const fareRoutes = require('../routes/fare');
// router.use('/fares', fareRoutes);

module.exports = router;
