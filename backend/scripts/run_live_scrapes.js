'use strict';

require('dotenv').config();
const { execSync } = require('child_process');
const mongoose = require('mongoose');
const Fare = require('../scraper/models/Fare');
const Route = require('../models/Route');
const IndexValue = require('../models/IndexValue');
const { connectDatabase } = require('../scraper/config/database');

const BASKET_ROUTES = [
  { origin: 'DEL', destination: 'BOM', route: 'DEL-BOM', weight: 0.22 },
  { origin: 'DEL', destination: 'BLR', route: 'DEL-BLR', weight: 0.18 },
  { origin: 'BOM', destination: 'BLR', route: 'BOM-BLR', weight: 0.14 },
  { origin: 'DEL', destination: 'CCU', route: 'DEL-CCU', weight: 0.12 },
  { origin: 'BLR', destination: 'HYD', route: 'BLR-HYD', weight: 0.10 },
  { origin: 'MAA', destination: 'DEL', route: 'MAA-DEL', weight: 0.09 },
  { origin: 'DEL', destination: 'HYD', route: 'DEL-HYD', weight: 0.08 },
  { origin: 'BOM', destination: 'CCU', route: 'BOM-CCU', weight: 0.07 }
];

const SOURCES = ['akasa', 'spicejet', 'indigo', 'airindia'];

async function runLiveScrapingPipeline() {
  console.log('Connecting to MongoDB Atlas...');
  await connectDatabase();
  console.log('Connected!');

  // STEP 1: PURGE ALL SAMPLE / SEEDED DATA
  console.log('Purging ALL sample & seeded data from MongoDB Atlas...');
  await Fare.deleteMany({});
  await IndexValue.deleteMany({});
  console.log('MongoDB Atlas cleared. Remaining fares count:', await Fare.countDocuments({}));

  // Ensure active basket routes
  await Route.deleteMany({});
  for (const r of BASKET_ROUTES) {
    await Route.create({ origin: r.origin, destination: r.destination, weight: r.weight, active: true });
  }

  // STEP 2: RUN LIVE SCRAPERS
  console.log('Triggering LIVE Scrapers for Akasa, SpiceJet, IndiGo, and Air India...');

  const travelDates = ['2026-09-15', '2026-09-20', '2026-09-25'];

  for (const r of BASKET_ROUTES.slice(0, 5)) { // Top routes
    for (const d of travelDates) {
      for (const src of SOURCES) {
        try {
          console.log(`[LIVE SCRAPE] Route=${r.route} Source=${src} Date=${d}`);
          const cmd = `python -m backend.scraper_python --origin ${r.origin} --destination ${r.destination} --date ${d} --source ${src} --mongo`;
          execSync(cmd, { cwd: process.cwd(), stdio: 'inherit' });
        } catch (err) {
          console.error(`Live scrape error for ${src} ${r.route}:`, err.message);
        }
      }
    }
  }

  const liveFareCount = await Fare.countDocuments({});
  console.log(`\nLIVE SCRAPING COMPLETE! Total Real Scraped Fares in MongoDB Atlas: ${liveFareCount}`);

  // STEP 3: COMPUTE APIx INDEX VALUES FROM REAL LIVE FARES ONLY
  console.log('Calculating APIx Index Values solely from real scraped fares...');
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  let weightedSum = 0;
  let totalWeight = 0;

  for (const r of BASKET_ROUTES) {
    const res = await Fare.aggregate([
      { $match: { route: r.route, dataQuality: 'VALID' } },
      { $group: { _id: null, avg: { $avg: '$totalFare' } } }
    ]);

    if (res[0] && res[0].avg) {
      const currentAvg = res[0].avg;
      weightedSum += currentAvg * r.weight;
      totalWeight += r.weight;

      await IndexValue.create({
        date: startOfDay,
        route: r.route,
        averageFare: Math.round(currentAvg),
        indexValue: Number((currentAvg / 5000 * 100).toFixed(2))
      });
    }
  }

  if (totalWeight > 0) {
    const overallAvg = weightedSum / totalWeight;
    await IndexValue.create({
      date: startOfDay,
      route: 'ALL',
      averageFare: Math.round(overallAvg),
      indexValue: Number((overallAvg / 5000 * 100).toFixed(2))
    });
  }

  console.log('Live Data Pipeline Complete!');
  process.exit(0);
}

runLiveScrapingPipeline().catch((err) => {
  console.error('Live scraping failed:', err);
  process.exit(1);
});
