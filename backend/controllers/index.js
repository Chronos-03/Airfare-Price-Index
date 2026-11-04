// Controllers placeholder for Phase 1.
// Business logic for future API endpoints (fares, routes, index values)
// will live here in subsequent phases.

const health = (req, res) => {
  res.json({ status: 'ok', service: 'airfare-index' });
};

module.exports = { health };
