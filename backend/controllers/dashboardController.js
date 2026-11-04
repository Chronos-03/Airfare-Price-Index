'use strict';

const Fare = require('../scraper/models/Fare');
const { validateFareRealtime } = require('../services/otaValidator');

/**
 * GET /api/stats
 * Single-pass MongoDB $facet aggregation for sub-50ms KPI calculation.
 */
async function getStats(req, res) {
  const minIso = req.query.from || null;
  const minDateObj = minIso ? new Date(`${minIso}T00:00:00.000Z`) : null;
  const dateMatch = minIso
    ? { $or: [{ travelDate: { $gte: minIso } }, { travelDate: { $gte: minDateObj } }] }
    : {};

  const [facetResults, lastUpdated, quoteResults] = await Promise.all([
    Fare.aggregate([
      {
        $facet: {
          summary: [
            { $match: dateMatch },
            {
              $group: {
                _id: null,
                totalQuotes: { $sum: 1 },
                validCount: { $sum: { $cond: [{ $eq: ['$dataQuality', 'VALID'] }, 1, 0] } },
                outlierCount: { $sum: { $cond: [{ $eq: ['$dataQuality', 'OUTLIER'] }, 1, 0] } },
                avgFare: { $avg: '$totalFare' },
                minFare: { $min: '$totalFare' },
                maxFare: { $max: '$totalFare' }
              }
            }
          ],
          distinctRoutes: [{ $match: dateMatch }, { $group: { _id: '$route' } }],
          routeOverview: [
            { $match: { route: { $ne: null }, totalFare: { $ne: null }, ...dateMatch } },
            {
              $group: {
                _id: '$route',
                origin: { $first: '$origin' },
                destination: { $first: '$destination' },
                avgFare: { $avg: '$totalFare' },
                count: { $sum: 1 }
              }
            },
            { $sort: { avgFare: -1 } },
            { $limit: 12 }
          ],
          leadTime: [
            { $match: { totalFare: { $ne: null }, advanceDays: { $ne: null }, ...dateMatch } },
            {
              $group: {
                _id: null,
                t1: { $avg: { $cond: [{ $lte: ['$advanceDays', 1] }, '$totalFare', null] } },
                t7: { $avg: { $cond: [{ $and: [{ $gt: ['$advanceDays', 1] }, { $lte: ['$advanceDays', 7] }] }, '$totalFare', null] } },
                t15: { $avg: { $cond: [{ $and: [{ $gt: ['$advanceDays', 7] }, { $lte: ['$advanceDays', 15] }] }, '$totalFare', null] } },
                t30: { $avg: { $cond: [{ $and: [{ $gt: ['$advanceDays', 15] }, { $lte: ['$advanceDays', 30] }] }, '$totalFare', null] } },
                t45: { $avg: { $cond: [{ $gt: ['$advanceDays', 30] }, '$totalFare', null] } }
              }
            }
          ],
          airlineComparison: [
            { $match: { airline: { $ne: null }, totalFare: { $ne: null }, ...dateMatch } },
            {
              $group: {
                _id: '$airline',
                avgFare: { $avg: '$totalFare' },
                count: { $sum: 1 }
              }
            },
            { $sort: { avgFare: 1 } }
          ]
        }
      }
    ]),
    Fare.findOne(dateMatch).sort({ updatedAt: -1 }).select('updatedAt scrapedAt').lean(),
    Fare.find({ totalFare: { $ne: null }, ...dateMatch })
      .sort({ _id: -1 })
      .limit(150)
      .select(
        'route origin destination airline flightNumber travelDate collectionDate advanceDays baseFare taxes udf convenienceFee totalFare availability dataQuality source'
      )
      .lean()
  ]);

  const facets = facetResults[0] || {};
  const summary = facets.summary && facets.summary[0] ? facets.summary[0] : {};
  
  const totalQuotes = summary.totalQuotes || 0;
  const validCount = summary.validCount || 0;
  const outlierCount = summary.outlierCount || 0;
  const avgFareVal = summary.avgFare || 0;
  const minFareVal = summary.minFare || 0;
  const maxFareVal = summary.maxFare || 0;
  const routesTracked = (facets.distinctRoutes || []).filter(r => r._id != null);
  
  const dataQualityPct = totalQuotes ? Math.round((validCount / totalQuotes) * 1000) / 10 : 0;
  const lead = (facets.leadTime && facets.leadTime[0]) ? facets.leadTime[0] : {};

  const recentQuotes = (quoteResults || [])
    .map((q) => {
      const valRes = validateFareRealtime(q);
      if (!valRes.isValid) return null;
      const cleanFare = valRes.cleanFare || q;

      let advDays = cleanFare.advanceDays;
      if (cleanFare.travelDate) {
        const t = new Date(cleanFare.travelDate);
        const c = cleanFare.scrapedAt ? new Date(cleanFare.scrapedAt) : (cleanFare.collectionDate ? new Date(cleanFare.collectionDate) : new Date());
        if (!isNaN(t.getTime()) && !isNaN(c.getTime())) {
          advDays = Math.max(1, Math.round((t.getTime() - c.getTime()) / (1000 * 60 * 60 * 24)));
        }
      }
      const windowTag = advDays != null ? `T+${advDays}` : '-';

      return {
        _id: cleanFare._id ? cleanFare._id.toString() : null,
        route: cleanFare.route || `${cleanFare.origin}-${cleanFare.destination}`,
        origin: cleanFare.origin,
        destination: cleanFare.destination,
        airline: cleanFare.airline || '-',
        flightNumber: cleanFare.flightNumber || '-',
        travelDate: cleanFare.travelDate,
        collectionDate: cleanFare.collectionDate,
        advanceDays: advDays,
        window: windowTag,
        baseFare: cleanFare.baseFare,
        taxes: cleanFare.taxes,
        udf: cleanFare.udf,
        convenienceFee: cleanFare.convenienceFee,
        totalFare: cleanFare.totalFare,
        currency: 'INR',
        availability: cleanFare.availability,
        dataQuality: cleanFare.dataQuality,
        source: cleanFare.source
      };
    })
    .filter(Boolean);

  const leadTimeResult = [
    { window: 'T+1', days: 1, avgFare: lead.t1 != null ? lead.t1 : null },
    { window: 'T+7', days: 7, avgFare: lead.t7 != null ? lead.t7 : null },
    { window: 'T+15', days: 15, avgFare: lead.t15 != null ? lead.t15 : null }
  ].filter((x) => x.avgFare != null);

  const routeOverviewResult = (facets.routeOverview || []).map((r) => ({
    route: r._id,
    origin: r.origin,
    destination: r.destination,
    avgFare: r.avgFare,
    count: r.count
  }));

  const airlineComparisonResult = (facets.airlineComparison || []).map((a) => ({
    airline: a._id,
    avgFare: a.avgFare,
    count: a.count
  }));

  const outliersRemoved = Math.max(outlierCount, totalQuotes - validCount);

  res.json({
    success: true,
    kpis: {
      totalQuotes,
      validQuotes: validCount,
      outliersRemoved,
      invalidCount: Math.max(0, totalQuotes - validCount),
      dataQualityPct,
      avgFare: avgFareVal,
      minFare: minFareVal,
      maxFare: maxFareVal,
      routesTracked: routesTracked.length,
      lastUpdated: lastUpdated ? lastUpdated.updatedAt || lastUpdated.scrapedAt : null
    },
    routeOverview: routeOverviewResult,
    leadTime: leadTimeResult,
    airlineComparison: airlineComparisonResult,
    recentQuotes,
    count: recentQuotes.length
  });
}

/**
 * GET /api/meta
 */
async function getMeta(req, res) {
  const minIso = req.query.from || null;
  const minDateObj = minIso ? new Date(`${minIso}T00:00:00.000Z`) : null;
  const dateMatch = minIso
    ? { $or: [{ travelDate: { $gte: minIso } }, { travelDate: { $gte: minDateObj } }] }
    : {};

  const [rawOrigins, rawDestinations, airlines, travelDates, pairsResult] = await Promise.all([
    Fare.distinct('origin', dateMatch),
    Fare.distinct('destination', dateMatch),
    Fare.distinct('airline', dateMatch),
    Fare.distinct('travelDate', dateMatch),
    Fare.aggregate([
      { $match: { origin: { $ne: null }, destination: { $ne: null }, ...dateMatch } },
      { $group: { _id: { origin: '$origin', destination: '$destination' }, count: { $sum: 1 } } }
    ])
  ]);

  const clean = (list) =>
    (list || [])
      .filter((v) => v != null && v !== '')
      .map((v) => (typeof v === 'string' ? v : String(v)))
      .sort();

  const validOrigins = clean(rawOrigins);
  const validDestinations = clean(rawDestinations);
  const allAirports = Array.from(new Set([...validOrigins, ...validDestinations])).sort();

  const validCityPairs = {};
  const reverseCityPairs = {};

  (pairsResult || []).forEach(p => {
    if (p && p._id && p._id.origin && p._id.destination) {
      const o = p._id.origin.toUpperCase();
      const d = p._id.destination.toUpperCase();
      if (!validCityPairs[o]) validCityPairs[o] = [];
      if (!validCityPairs[o].includes(d)) validCityPairs[o].push(d);

      if (!reverseCityPairs[d]) reverseCityPairs[d] = [];
      if (!reverseCityPairs[d].includes(o)) reverseCityPairs[d].push(o);
    }
  });

  // Sort destination and origin arrays inside maps
  Object.keys(validCityPairs).forEach(k => validCityPairs[k].sort());
  Object.keys(reverseCityPairs).forEach(k => reverseCityPairs[k].sort());

  const dates = (travelDates || [])
    .map((d) => {
      const dt = d instanceof Date ? d : new Date(d);
      return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
    })
    .filter((d) => d && d >= minIso)
    .sort();

  const totalRoutesCount = (pairsResult || []).length;
  const totalCitiesCount = allAirports.length;

  res.json({
    success: true,
    origins: validOrigins,
    destinations: validDestinations,
    allAirports,
    totalCities: totalCitiesCount,
    totalRoutes: totalRoutesCount,
    validCityPairs,
    reverseCityPairs,
    airlines: clean(airlines),
    travelDates: dates,
    dateRange: {
      min: dates[0] ? `${dates[0]}T00:00:00.000Z` : null,
      max: dates[dates.length - 1] ? `${dates[dates.length - 1]}T23:59:59.999Z` : null
    }
  });
}

function leadTimeLabel(advanceDays) {
  if (advanceDays == null) return '-';
  if (advanceDays <= 1) return 'T+1';
  if (advanceDays <= 7) return 'T+7';
  if (advanceDays <= 15) return 'T+15';
  if (advanceDays <= 30) return 'T+30';
  return 'T+45';
}

module.exports = { getStats, getMeta };
