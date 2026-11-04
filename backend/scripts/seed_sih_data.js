'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const Fare = require('../scraper/models/Fare');
const Route = require('../models/Route');
const IndexValue = require('../models/IndexValue');
const { connectDatabase } = require('../scraper/config/database');

// Representative DGCA Basket City-Pairs with Traffic Weights
const BASKET_ROUTES = [
  { origin: 'DEL', destination: 'BOM', route: 'DEL-BOM', weight: 0.22, baseAvgFare: 5200 },
  { origin: 'DEL', destination: 'BLR', route: 'DEL-BLR', weight: 0.18, baseAvgFare: 5800 },
  { origin: 'BOM', destination: 'BLR', route: 'BOM-BLR', weight: 0.14, baseAvgFare: 4600 },
  { origin: 'DEL', destination: 'CCU', route: 'DEL-CCU', weight: 0.12, baseAvgFare: 5400 },
  { origin: 'BLR', destination: 'HYD', route: 'BLR-HYD', weight: 0.10, baseAvgFare: 3400 },
  { origin: 'MAA', destination: 'DEL', route: 'MAA-DEL', weight: 0.09, baseAvgFare: 6100 },
  { origin: 'DEL', destination: 'HYD', route: 'DEL-HYD', weight: 0.08, baseAvgFare: 4900 },
  { origin: 'BOM', destination: 'CCU', route: 'BOM-CCU', weight: 0.07, baseAvgFare: 5700 }
];

// Major Indian Airlines specified in SIH Problem Statement
const AIRLINES = [
  { name: 'IndiGo', code: '6E', multiplier: 0.95 },
  { name: 'Air India', code: 'AI', multiplier: 1.10 },
  { name: 'Air India Express', code: 'IX', multiplier: 0.90 },
  { name: 'Akasa Air', code: 'QP', multiplier: 0.92 },
  { name: 'SpiceJet', code: 'SG', multiplier: 0.88 }
];

// Sources (Direct Airline Portals + Major OTAs)
const SOURCES = ['indigo', 'airindia', 'akasa', 'makemytrip', 'easemytrip', 'yatra'];

// Advance Purchase Windows (Days ahead)
const ADVANCE_WINDOWS = [1, 7, 15, 30, 45];

function computeDedupeKey(origin, destination, travelDateStr, airline, flightNumber, fareClass, source) {
  const raw = `${origin}|${destination}|${travelDateStr}|${airline}|${flightNumber}|${fareClass}|${source}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function seed() {
  console.log('Connecting to MongoDB Atlas...');
  await connectDatabase();
  console.log('Connected!');

  // Clear existing collections for a clean, deterministic 30-day benchmark dataset
  await Fare.deleteMany({});
  await Route.deleteMany({});
  await IndexValue.deleteMany({});
  console.log('Cleared existing fares, routes, and indexvalues collections.');

  // Seed Routes with DGCA Traffic Weights
  for (const r of BASKET_ROUTES) {
    await Route.create({
      origin: r.origin,
      destination: r.destination,
      weight: r.weight,
      active: true
    });
  }
  console.log(`Seeded ${BASKET_ROUTES.length} DGCA basket routes with traffic weights.`);

  const now = new Date();
  const faresToInsert = [];
  const daysOfHistory = 35; // 35 days of back-tested historical daily data

  for (let d = daysOfHistory; d >= 0; d--) {
    const scrapedDate = new Date(now);
    scrapedDate.setDate(now.getDate() - d);
    const scrapedDateStr = scrapedDate.toISOString().slice(0, 10);

    // Simulate macro inflation trend & day-of-week demand surges
    const dayOfWeek = scrapedDate.getDay(); // 0 = Sun, 6 = Sat
    const weekendSurge = (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) ? 1.12 : 1.0;
    const inflationTrend = 1.0 + ((daysOfHistory - d) * 0.003); // Slight realistic escalation over time

    for (const r of BASKET_ROUTES) {
      for (const advWindow of ADVANCE_WINDOWS) {
        // Advance booking window multiplier: T+1 is 1.65x, T+7 is 1.28x, T+15 is 1.0x, T+30 is 0.84x, T+45 is 0.74x
        let windowMultiplier = 1.0;
        if (advWindow === 1) windowMultiplier = 1.65;
        else if (advWindow === 7) windowMultiplier = 1.28;
        else if (advWindow === 15) windowMultiplier = 1.00;
        else if (advWindow === 30) windowMultiplier = 0.84;
        else if (advWindow === 45) windowMultiplier = 0.74;

        const travelDate = new Date(scrapedDate);
        travelDate.setDate(scrapedDate.getDate() + advWindow);
        const travelDateStr = travelDate.toISOString().slice(0, 10);

        // Pick 2-3 airlines per window/route combo
        for (const airline of AIRLINES) {
          const flightNumber = `${airline.code}${randomBetween(100, 999)}`;
          const source = SOURCES[randomBetween(0, SOURCES.length - 1)];

          const basePrice = r.baseAvgFare * airline.multiplier * windowMultiplier * weekendSurge * inflationTrend;
          const noise = 1.0 + ((Math.random() - 0.5) * 0.08); // +/- 4% random noise
          const baseFare = Math.round(basePrice * noise);

          const taxes = Math.round(baseFare * 0.18); // ~18% taxes + airport charges
          const udf = randomBetween(150, 450);
          const convenienceFee = source.includes('trip') || source.includes('yatra') ? 350 : 0;
          const totalFare = baseFare + taxes + udf + convenienceFee;

          // Outlier injection (1% of quotes for data quality testing)
          const isOutlier = Math.random() < 0.01;
          const finalTotalFare = isOutlier ? totalFare * 3.5 : totalFare;
          const dataQuality = isOutlier ? 'OUTLIER' : 'VALID';

          const dedupeKey = computeDedupeKey(
            r.origin,
            r.destination,
            travelDateStr,
            airline.name,
            flightNumber,
            'Economy',
            source
          );

          faresToInsert.push({
            origin: r.origin,
            destination: r.destination,
            route: r.route,
            airline: airline.name,
            flightNumber,
            travelDate,
            collectionDate: scrapedDate,
            scrapedAt: scrapedDate,
            advanceDays: advWindow,
            fareClass: 'Economy',
            baseFare,
            taxes,
            udf,
            convenienceFee,
            totalFare: finalTotalFare,
            currency: 'INR',
            availability: 'AVAILABLE',
            source,
            dataQuality,
            dedupeKey,
            createdAt: scrapedDate,
            updatedAt: scrapedDate
          });
        }
      }
    }
  }

  console.log(`Inserting ${faresToInsert.length} back-tested fare records into MongoDB...`);
  
  // Bulk insert in chunks of 500
  const chunkSize = 500;
  for (let i = 0; i < faresToInsert.length; i += chunkSize) {
    const chunk = faresToInsert.slice(i, i + chunkSize);
    await Fare.insertMany(chunk, { ordered: false }).catch(() => {});
  }

  const finalCount = await Fare.countDocuments({});
  console.log(`Successfully seeded ${finalCount} fare quotes into MongoDB Atlas!`);

  // Compute Daily APIx Index Values
  console.log('Calculating historical daily APIx index values...');

  // Compute Base Fare per route
  const baseFares = {};
  for (const r of BASKET_ROUTES) {
    const res = await Fare.aggregate([
      { $match: { route: r.route, dataQuality: 'VALID' } },
      { $group: { _id: null, avg: { $avg: '$totalFare' } } }
    ]);
    baseFares[r.route] = res[0] ? res[0].avg : r.baseAvgFare;
  }

  for (let d = daysOfHistory; d >= 0; d--) {
    const dayDate = new Date(now);
    dayDate.setDate(now.getDate() - d);
    const startOfDay = new Date(dayDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dayDate);
    endOfDay.setHours(23, 59, 59, 999);

    let weightedSum = 0;
    let totalWeight = 0;

    for (const r of BASKET_ROUTES) {
      const res = await Fare.aggregate([
        { $match: { route: r.route, collectionDate: { $gte: startOfDay, $lte: endOfDay }, dataQuality: 'VALID' } },
        { $group: { _id: null, avg: { $avg: '$totalFare' } } }
      ]);

      const currentAvg = res[0] ? res[0].avg : baseFares[r.route];
      const routeRatio = currentAvg / baseFares[r.route];
      weightedSum += routeRatio * r.weight;
      totalWeight += r.weight;

      await IndexValue.create({
        date: startOfDay,
        route: r.route,
        averageFare: Math.round(currentAvg),
        indexValue: Number((routeRatio * 100).toFixed(2))
      });
    }

    const overallIndex = Number(((weightedSum / totalWeight) * 100).toFixed(2));
    await IndexValue.create({
      date: startOfDay,
      route: 'ALL',
      averageFare: Math.round((weightedSum / totalWeight) * 5200),
      indexValue: overallIndex
    });
  }

  console.log('Seeding & Index computation complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
