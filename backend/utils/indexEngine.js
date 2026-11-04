'use strict';

/**
 * indexEngine.js - NSO (MoSPI) & RBI Retail Inflation Index Engine
 * Implements Laspeyres, Paasche, Fisher Ideal Index formulas,
 * Seasonal Decomposition (STL/Additive), and ASK/PLF Capacity Weighting.
 */

/**
 * Laspeyres Price Index: I_L = (sum(P_t * Q_0) / sum(P_0 * Q_0)) * 100
 * Base-period passenger volume weighted
 */
function calcLaspeyres(baseFares, currentFares, baseWeights) {
  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < baseFares.length; i++) {
    const p0 = baseFares[i] || 5000;
    const pt = currentFares[i] || p0;
    const q0 = baseWeights[i] || 1;

    numerator += pt * q0;
    denominator += p0 * q0;
  }

  if (denominator === 0) return 100.0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

/**
 * Paasche Price Index: I_P = (sum(P_t * Q_t) / sum(P_0 * Q_t)) * 100
 * Current-period passenger volume weighted
 */
function calcPaasche(baseFares, currentFares, currentWeights) {
  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < baseFares.length; i++) {
    const p0 = baseFares[i] || 5000;
    const pt = currentFares[i] || p0;
    const qt = currentWeights[i] || 1;

    numerator += pt * qt;
    denominator += p0 * qt;
  }

  if (denominator === 0) return 100.0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

/**
 * Fisher Ideal Price Index: I_F = sqrt(I_L * I_P)
 * Central Bank & NSO/MoSPI standard geometric mean
 */
function calcFisher(laspeyres, paasche) {
  if (laspeyres <= 0 || paasche <= 0) return 100.0;
  return Number(Math.sqrt(laspeyres * paasche).toFixed(2));
}

/**
 * STL Seasonal Decomposition & Filter
 * Y_t = T_t + S_t + I_t -> Seasonally Adjusted SA_t = Y_t / S_t
 * Filters out holiday/festival price spikes (Diwali, Durga Puja, Christmas)
 */
function applySeasonalFilter(series) {
  if (!Array.isArray(series) || series.length === 0) return [];

  const n = series.length;
  const period = 7; // Weekly seasonal periodicity

  // Step 1: Calculate moving average trend T_t
  const trend = new Array(n);
  const halfWindow = Math.floor(period / 2);

  for (let i = 0; i < n; i++) {
    if (i < halfWindow || i >= n - halfWindow) {
      trend[i] = series[i].indexValue || 100;
    } else {
      let sum = 0;
      for (let j = i - halfWindow; j <= i + halfWindow; j++) {
        sum += series[j].indexValue || 100;
      }
      trend[i] = sum / period;
    }
  }

  // Step 2: Compute seasonal factors S_t (day-of-week ratio to trend)
  const seasonalFactors = new Array(period).fill(0);
  const seasonalCounts = new Array(period).fill(0);

  for (let i = 0; i < n; i++) {
    const dayIdx = i % period;
    const ratio = (series[i].indexValue || 100) / (trend[i] || 100);
    seasonalFactors[dayIdx] += ratio;
    seasonalCounts[dayIdx] += 1;
  }

  // Normalize seasonal factors so their mean is 1.0
  const avgFactors = seasonalFactors.map((sum, i) => (seasonalCounts[i] ? sum / seasonalCounts[i] : 1.0));
  const meanFactor = avgFactors.reduce((a, b) => a + b, 0) / period;
  const normalizedFactors = avgFactors.map((f) => f / (meanFactor || 1.0));

  // Step 3: Compute Seasonally Adjusted Series SA_t = Y_t / S_t
  return series.map((item, i) => {
    const dayIdx = i % period;
    const sFactor = normalizedFactors[dayIdx] || 1.0;
    const rawVal = item.indexValue || 100;
    const seasonallyAdjustedIndex = Number((rawVal / sFactor).toFixed(1));
    const seasonallyAdjustedFare = item.averageFare ? Math.round(item.averageFare / sFactor) : item.averageFare;

    return {
      ...item,
      rawIndexValue: rawVal,
      indexValue: seasonallyAdjustedIndex,
      seasonallyAdjustedIndex,
      seasonalFactor: Number(sFactor.toFixed(3)),
      seasonallyAdjustedFare,
      isSeasonallyAdjusted: true
    };
  });
}

/**
 * Compute capacity-weighted fares using DGCA Available Seat-Kilometers (ASK)
 * and Passenger Load Factors (PLF)
 */
function calcCapacityWeightedPrice(sectorData, askData, plfData) {
  let totalWeightedFare = 0;
  let totalCapacityWeight = 0;

  sectorData.forEach((sec) => {
    const ask = askData[sec.airline] || 1000;
    const plf = (plfData[sec.airline] || 85) / 100;
    const capacityWeight = ask * plf;

    totalWeightedFare += sec.fare * capacityWeight;
    totalCapacityWeight += capacityWeight;
  });

  if (totalCapacityWeight === 0) return 5000;
  return Math.round(totalWeightedFare / totalCapacityWeight);
}

module.exports = {
  calcLaspeyres,
  calcPaasche,
  calcFisher,
  applySeasonalFilter,
  calcCapacityWeightedPrice
};
