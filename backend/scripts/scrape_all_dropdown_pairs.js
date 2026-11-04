'use strict';

require('dotenv').config();
const { execSync } = require('child_process');
const mongoose = require('mongoose');
const Fare = require('../scraper/models/Fare');
const Route = require('../models/Route');
const IndexValue = require('../models/IndexValue');
const { connectDatabase } = require('../scraper/config/database');

const ALL_AIRPORTS = [
  'BLR', 'BOM', 'DEL', 'CCU', 'HYD', 'MAA',
  'GOI', 'PNQ', 'AMD', 'COK', 'BBI', 'CCJ',
  'TRV', 'JAI', 'ATQ', 'VTZ', 'IXC', 'PAT',
  'LKO', 'GAU'
];

const DATES = ['2026-09-15', '2026-09-20', '2026-09-25'];
const SOURCES = ['akasa', 'indigo', 'airindia', 'spicejet'];

async function scrapeAllPairs() {
  console.log('Connecting to MongoDB Atlas...');
  await connectDatabase();
  console.log('Connected!');

  const pairs = [];
  for (const origin of ALL_AIRPORTS) {
    for (const dest of ALL_AIRPORTS) {
      if (origin !== dest) {
        pairs.push({ origin, destination: dest, route: `${origin}-${dest}` });
      }
    }
  }

  console.log(`Extracting live scraped data for ALL ${pairs.length} Origin-Destination dropdown pairs...`);

  // Ensure active routes in Route collection
  await Route.deleteMany({});
  for (const p of pairs) {
    await Route.create({ origin: p.origin, destination: p.destination, weight: 1.0 / pairs.length, active: true });
  }

  let count = 0;
  for (const p of pairs) {
    for (const d of DATES) {
      for (const src of SOURCES) {
        count++;
        try {
          console.log(`[PAIR ${count}/${pairs.length * DATES.length * SOURCES.length}] ${p.route} (${src}) ${d}`);
          const cmd = `python -m backend.scraper_python --origin ${p.origin} --destination ${p.destination} --date ${d} --source ${src} --mongo`;
          execSync(cmd, { cwd: process.cwd(), stdio: 'inherit' });
        } catch (err) {
          console.error(`Live scrape error for ${p.route} ${src}:`, err.message);
        }
      }
    }
  }

  // Deduplication check
  const dupes = await Fare.aggregate([
    { $group: { _id: '$dedupeKey', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]);

  const totalFares = await Fare.countDocuments({});
  const distinctOrigins = await Fare.distinct('origin');
  const distinctDestinations = await Fare.distinct('destination');
  const distinctRoutes = await Fare.distinct('route');

  console.log('\n================ EXTRACTION COMPLETE ================');
  console.log(`Total Real Live Scraped Quotes in MongoDB: ${totalFares}`);
  console.log(`Duplicate Records (dedupeKey duplicates): ${dupes.length} (0 = Zero Duplicates)`);
  console.log(`Distinct Origins Covered:`, distinctOrigins);
  console.log(`Distinct Destinations Covered:`, distinctDestinations);
  console.log(`Total Unique Routes Covered: ${distinctRoutes.length}`);
  console.log('=====================================================\n');

  // Calculate live APIx indices for ALL pairs
  await IndexValue.deleteMany({});
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  let weightedSum = 0;
  let totalWeight = 0;

  for (const r of distinctRoutes) {
    const res = await Fare.aggregate([
      { $match: { route: r, dataQuality: 'VALID' } },
      { $group: { _id: null, avg: { $avg: '$totalFare' } } }
    ]);

    if (res[0] && res[0].avg) {
      const currentAvg = res[0].avg;
      weightedSum += currentAvg;
      totalWeight += 1;

      await IndexValue.create({
        date: startOfDay,
        route: r,
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

  process.exit(0);
}

scrapeAllPairs().catch((err) => {
  console.error('All pair extraction failed:', err);
  process.exit(1);
});
