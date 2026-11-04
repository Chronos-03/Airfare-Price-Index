'use strict';

require('dotenv').config();
const { execSync } = require('child_process');
const mongoose = require('mongoose');
const Fare = require('../scraper/models/Fare');
const Route = require('../models/Route');
const IndexValue = require('../models/IndexValue');
const { connectDatabase } = require('../scraper/config/database');

const ROUTES = [
  { origin: 'DEL', destination: 'BOM', route: 'DEL-BOM', weight: 0.22 },
  { origin: 'DEL', destination: 'BLR', route: 'DEL-BLR', weight: 0.18 },
  { origin: 'BOM', destination: 'BLR', route: 'BOM-BLR', weight: 0.14 },
  { origin: 'DEL', destination: 'CCU', route: 'DEL-CCU', weight: 0.12 },
  { origin: 'BLR', destination: 'HYD', route: 'BLR-HYD', weight: 0.10 },
  { origin: 'MAA', destination: 'DEL', route: 'MAA-DEL', weight: 0.09 },
  { origin: 'DEL', destination: 'HYD', route: 'DEL-HYD', weight: 0.08 },
  { origin: 'BOM', destination: 'CCU', route: 'BOM-CCU', weight: 0.07 }
];

const SOURCES = ['akasa', 'indigo', 'airindia', 'spicejet'];
const DATES = ['2026-09-10', '2026-09-15', '2026-09-20', '2026-09-25', '2026-09-30', '2026-10-05', '2026-10-15'];

async function extractBroadLiveData() {
  console.log('Connecting to MongoDB Atlas...');
  await connectDatabase();
  console.log('Connected!');

  // Save active routes
  await Route.deleteMany({});
  for (const r of ROUTES) {
    await Route.create({ origin: r.origin, destination: r.destination, weight: r.weight, active: true });
  }

  console.log(`Starting broad LIVE extraction across ${ROUTES.length} routes x ${DATES.length} dates x ${SOURCES.length} sources...`);

  let totalJobs = 0;
  for (const r of ROUTES) {
    for (const d of DATES) {
      for (const src of SOURCES) {
        totalJobs++;
        try {
          console.log(`[LIVE EXTRACTION #${totalJobs}] Route=${r.route} Source=${src} Date=${d}`);
          const cmd = `python -m backend.scraper_python --origin ${r.origin} --destination ${r.destination} --date ${d} --source ${src} --mongo`;
          execSync(cmd, { cwd: process.cwd(), stdio: 'inherit' });
        } catch (err) {
          console.error(`Live extraction error for ${src} ${r.route} ${d}:`, err.message);
        }
      }
    }
  }

  const liveFareCount = await Fare.countDocuments({});
  console.log(`\nBROAD LIVE EXTRACTION COMPLETE! Total Live Scraped Fares in MongoDB Atlas: ${liveFareCount}`);

  // Re-calculate live APIx index entries
  console.log('Re-calculating live APIx index values...');
  await IndexValue.deleteMany({});
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  let weightedSum = 0;
  let totalWeight = 0;

  for (const r of ROUTES) {
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

  console.log('Broad Live Extraction Pipeline Complete!');
  process.exit(0);
}

extractBroadLiveData().catch((err) => {
  console.error('Broad live extraction failed:', err);
  process.exit(1);
});
