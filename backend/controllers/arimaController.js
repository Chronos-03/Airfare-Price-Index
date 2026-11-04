'use strict';

const Fare = require('../scraper/models/Fare');
const {
  calcArimaForecast,
  detectSurges,
  detectOutages
} = require('../utils/arimaEngine');

/**
 * Fetch historical daily price series purely from MongoDB Atlas Fare documents
 */
async function getHistoricalFareSeries(route, airline) {
  const matchFilter = { 
    travelDate: { $ne: null },
    totalFare: { $gte: 1200, $lte: 45000 } 
  };
  if (route && route !== 'ALL') {
    matchFilter.route = new RegExp(`^${route.trim()}$`, 'i');
  }
  if (airline && airline !== 'ALL') {
    matchFilter.airline = new RegExp(airline.trim(), 'i');
  }

  const todayISO = new Date().toISOString().slice(0, 10);

  // Aggregate historical actuals up to current date
  let faresByDate = await Fare.aggregate([
    { $match: { ...matchFilter, travelDate: { $lte: new Date(`${todayISO}T23:59:59.999Z`) } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$travelDate' } },
        avgFare: { $avg: '$totalFare' },
        count: { $sum: 1 }
      }
    },
    { $match: { _id: { $ne: null, $ne: '1970-01-01' } } },
    { $sort: { _id: 1 } }
  ]);

  // Fallback to recent 21 database dates if historical actuals up to today yield fewer than 5 dates
  if (!faresByDate || faresByDate.length < 5) {
    faresByDate = await Fare.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$travelDate' } },
          avgFare: { $avg: '$totalFare' },
          count: { $sum: 1 }
        }
      },
      { $match: { _id: { $ne: null, $ne: '1970-01-01' } } },
      { $sort: { _id: 1 } },
      { $limit: 21 }
    ]);
  }

  // Extract dates and prices dynamically from database documents
  const dates = faresByDate.map((item) => item._id);
  const rawValues = faresByDate.map((item) => Math.round(item.avgFare));

  // 3-point moving average smoothing to eliminate sample scraping noise while preserving macro seasonality
  const values = rawValues.map((val, idx, arr) => {
    if (idx === 0 || idx === arr.length - 1) return val;
    return Math.round(0.25 * arr[idx - 1] + 0.5 * val + 0.25 * arr[idx + 1]);
  });

  const totalSum = values.reduce((acc, item) => acc + item, 0);
  const overallAvg = values.length > 0 ? Math.round(totalSum / values.length) : 5000;

  return { dates, values, overallAvg };
}

/**
 * GET /api/forecast/arima
 */
async function getArimaForecast(req, res) {
  const route = (req.query.route || 'ALL').toUpperCase();
  const airline = req.query.airline || 'ALL';
  const horizon = parseInt(req.query.days, 10) || 14;

  const rawP = req.query.p;
  const rawD = req.query.d;
  const rawQ = req.query.q;

  const p = (rawP === 'auto' || rawP === 'Auto') ? 'auto' : (parseInt(rawP, 10) || 2);
  const d = (rawD === 'auto' || rawD === 'Auto') ? 'auto' : (parseInt(rawD, 10) || 1);
  const q = (rawQ === 'auto' || rawQ === 'Auto') ? 'auto' : (parseInt(rawQ, 10) || 1);

  const historical = await getHistoricalFareSeries(route, airline);
  const result = calcArimaForecast(historical.values, horizon, p, d, q, historical.dates);

  const activeP = result.params ? result.params.p : 2;
  const activeD = result.params ? result.params.d : 1;
  const activeQ = result.params ? result.params.q : 1;

  // Generate future dates dynamically starting from last historical travel date in DB
  const startDate = historical.dates.length > 0 
    ? new Date(historical.dates[historical.dates.length - 1])
    : new Date();

  const forecastWithDates = result.forecast.map((item, idx) => {
    const fDate = new Date(startDate);
    fDate.setDate(fDate.getDate() + (idx + 1));
    const dateStr = fDate.toISOString().slice(0, 10);
    return {
      ...item,
      date: dateStr,
      dayName: fDate.toLocaleDateString('en-US', { weekday: 'short' })
    };
  });

  res.json({
    status: 'ok',
    model: `ARIMA(${activeP},${activeD},${activeQ})`,
    route,
    airline,
    horizonDays: horizon,
    historical: {
      dates: historical.dates,
      values: historical.values,
      averageFare: historical.overallAvg
    },
    forecast: forecastWithDates,
    metrics: {
      rmse: result.rmse,
      mae: result.mae,
      r2Score: result.r2Score,
      lastObservedFare: result.lastObservedFare
    },
    generatedAt: new Date().toISOString()
  });
}

/**
 * GET /api/forecast/surges
 */
async function getSurgeAlerts(req, res) {
  const route = (req.query.route || 'ALL').toUpperCase();
  const airline = req.query.airline || 'ALL';
  const horizon = parseInt(req.query.days, 10) || 14;

  const historical = await getHistoricalFareSeries(route, airline);
  const result = calcArimaForecast(historical.values, horizon, 2, 1, 1, historical.dates);
  const surgeAlerts = detectSurges(result.forecast, historical.overallAvg);

  const startDate = historical.dates.length > 0 
    ? new Date(historical.dates[historical.dates.length - 1])
    : new Date();

  const alertsWithDates = surgeAlerts.map((alert) => {
    const fDate = new Date(startDate);
    fDate.setDate(fDate.getDate() + alert.step);
    return {
      ...alert,
      date: fDate.toISOString().slice(0, 10),
      dayName: fDate.toLocaleDateString('en-US', { weekday: 'short' })
    };
  });

  res.json({
    status: 'ok',
    route,
    airline,
    baselineFare: historical.overallAvg,
    totalAlerts: alertsWithDates.length,
    criticalCount: alertsWithDates.filter((a) => a.riskLevel === 'CRITICAL').length,
    highCount: alertsWithDates.filter((a) => a.riskLevel === 'HIGH').length,
    moderateCount: alertsWithDates.filter((a) => a.riskLevel === 'MODERATE').length,
    alerts: alertsWithDates
  });
}

/**
 * GET /api/forecast/outages
 */
async function getOutageRisks(req, res) {
  const route = (req.query.route || 'ALL').toUpperCase();
  const airline = req.query.airline || 'ALL';

  const historical = await getHistoricalFareSeries(route, airline);
  const result = calcArimaForecast(historical.values, 14, 2, 1, 1, historical.dates);
  const outageRisks = detectOutages(result.forecast, historical.overallAvg);

  const startDate = historical.dates.length > 0 
    ? new Date(historical.dates[historical.dates.length - 1])
    : new Date();

  const risksWithDates = outageRisks.map((risk) => {
    const fDate = new Date(startDate);
    fDate.setDate(fDate.getDate() + risk.step);
    return {
      ...risk,
      date: fDate.toISOString().slice(0, 10),
      affectedRoute: route === 'ALL' ? 'National Network Sectors' : route
    };
  });

  res.json({
    status: 'ok',
    route,
    airline,
    totalRisks: risksWithDates.length,
    severeOutageRisks: risksWithDates.filter((r) => r.riskCategory === 'SEVERE_OUTAGE_RISK').length,
    risks: risksWithDates
  });
}

/**
 * GET /api/forecast/summary
 */
async function getForecastSummary(req, res) {
  const historical = await getHistoricalFareSeries('ALL', 'ALL');
  const result = calcArimaForecast(historical.values, 14, 2, 1, 1, historical.dates);
  const surges = detectSurges(result.forecast, historical.overallAvg);
  const outages = detectOutages(result.forecast, historical.overallAvg);

  const avgForecastFare = Math.round(
    result.forecast.reduce((acc, f) => acc + f.forecastFare, 0) / (result.forecast.length || 1)
  );
  const predictedPctChange = Number(
    (((avgForecastFare - historical.overallAvg) / (historical.overallAvg || 1)) * 100).toFixed(1)
  );

  res.json({
    status: 'ok',
    summary: {
      modelName: `ARIMA(${result.params ? result.params.p : 2},${result.params ? result.params.d : 1},${result.params ? result.params.q : 1}) + STL Day-of-Week`,
      historicalBaselineFare: historical.overallAvg,
      predicted14DayFare: avgForecastFare,
      predictedPctChange,
      forecastedIndex: Number(((avgForecastFare / 5000) * 100).toFixed(1)),
      activeSurgeAlertsCount: surges.length,
      criticalSurgesCount: surges.filter((s) => s.riskLevel === 'CRITICAL').length,
      outageRisksCount: outages.length,
      modelR2Score: result.r2Score,
      modelRmse: result.rmse,
      modelMae: result.mae
    },
    generatedAt: new Date().toISOString()
  });
}

module.exports = {
  getArimaForecast,
  getSurgeAlerts,
  getOutageRisks,
  getForecastSummary
};
