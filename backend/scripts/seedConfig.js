'use strict';

/**
 * Seed script to populate database with initial configuration data
 * that was previously hardcoded in the application.
 * 
 * Run with: node backend/scripts/seedConfig.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDatabase } = require('../scraper/config/database');

const CapacityWeight = require('../models/CapacityWeight');
const FareComponent = require('../models/FareComponent');
const BasketWeight = require('../models/BasketWeight');
const HeatmapWindowRatio = require('../models/HeatmapWindowRatio');
const BacktestBenchmark = require('../models/BacktestBenchmark');
const ScheduleConfig = require('../models/ScheduleConfig');

const CAPACITY_WEIGHTS = [
  { airline: 'IndiGo', code: '6E', askMillionKm: 4850, plfPct: 89.2, capacityWeightPct: 51.5, period: '2026-Q3' },
  { airline: 'Air India', code: 'AI', askMillionKm: 2350, plfPct: 84.5, capacityWeightPct: 23.8, period: '2026-Q3' },
  { airline: 'Akasa Air', code: 'QP', askMillionKm: 1120, plfPct: 86.8, capacityWeightPct: 11.6, period: '2026-Q3' },
  { airline: 'SpiceJet', code: 'SG', askMillionKm: 1090, plfPct: 88.1, capacityWeightPct: 13.1, period: '2026-Q3' }
];

const UDF_COMPONENTS = [
  { airportCode: 'DEL', amount: 290 },
  { airportCode: 'BOM', amount: 340 },
  { airportCode: 'BLR', amount: 380 },
  { airportCode: 'CCU', amount: 450 },
  { airportCode: 'HYD', amount: 480 },
  { airportCode: 'MAA', amount: 210 },
  { airportCode: 'AMD', amount: 220 },
  { airportCode: 'PNQ', amount: 190 }
];

const CONVENIENCE_COMPONENTS = [
  { airline: 'IndiGo', amount: 300 },
  { airline: 'Air India', amount: 0 },
  { airline: 'SpiceJet', amount: 375 },
  { airline: 'Akasa Air', amount: 250 },
  { airline: 'Air India Express', amount: 275 }
];

const BASKET_WEIGHTS = [
  { route: 'DEL-BOM', weight: 22, baseFare: 5200 },
  { route: 'DEL-BLR', weight: 18, baseFare: 5800 },
  { route: 'BOM-BLR', weight: 14, baseFare: 4600 },
  { route: 'DEL-CCU', weight: 12, baseFare: 5400 },
  { route: 'BLR-HYD', weight: 10, baseFare: 3400 },
  { route: 'MAA-DEL', weight: 9, baseFare: 6100 },
  { route: 'DEL-HYD', weight: 8, baseFare: 4900 },
  { route: 'BOM-CCU', weight: 7, baseFare: 5700 }
];

const HEATMAP_WINDOW_RATIOS = [
  { window: 'T+1', ratio: 1.25, description: 'Last-minute booking premium' },
  { window: 'T+7', ratio: 1.05, description: 'Short-term booking slight premium' },
  { window: 'T+15', ratio: 0.95, description: 'Mid-term booking slight discount' },
  { window: 'T+30', ratio: 0.88, description: 'Advance booking discount' },
  { window: 'T+45', ratio: 0.82, description: 'Early booking significant discount' }
];

const DEFAULT_SCHEDULE = {
  key: 'default',
  frequency: 'daily',
  time: '06:00 AM IST',
  active: true,
  nextRun: new Date(Date.now() + 24 * 60 * 60 * 1000),
  lastRun: new Date()
};

async function seedDatabase() {
  try {
    await connectDatabase();
    console.log('Connected to MongoDB');

    // Seed Capacity Weights
    for (const cw of CAPACITY_WEIGHTS) {
      await CapacityWeight.findOneAndUpdate(
        { airline: cw.airline, period: cw.period },
        cw,
        { upsert: true, new: true }
      );
    }
    console.log(`Seeded ${CAPACITY_WEIGHTS.length} capacity weight records`);

    // Seed UDF Components
    for (const udf of UDF_COMPONENTS) {
      await FareComponent.findOneAndUpdate(
        { type: 'UDF', airportCode: udf.airportCode },
        { type: 'UDF', ...udf },
        { upsert: true, new: true }
      );
    }
    console.log(`Seeded ${UDF_COMPONENTS.length} UDF component records`);

    // Seed Convenience Fee Components
    for (const cf of CONVENIENCE_COMPONENTS) {
      await FareComponent.findOneAndUpdate(
        { type: 'CONVENIENCE_FEE', airline: cf.airline },
        { type: 'CONVENIENCE_FEE', ...cf },
        { upsert: true, new: true }
      );
    }
    console.log(`Seeded ${CONVENIENCE_COMPONENTS.length} convenience fee records`);

    // Seed Basket Weights
    for (const bw of BASKET_WEIGHTS) {
      await BasketWeight.findOneAndUpdate(
        { route: bw.route },
        bw,
        { upsert: true, new: true }
      );
    }
    console.log(`Seeded ${BASKET_WEIGHTS.length} basket weight records`);

    // Seed Heatmap Window Ratios
    for (const ratio of HEATMAP_WINDOW_RATIOS) {
      await HeatmapWindowRatio.findOneAndUpdate(
        { window: ratio.window },
        ratio,
        { upsert: true, new: true }
      );
    }
    console.log(`Seeded ${HEATMAP_WINDOW_RATIOS.length} heatmap window ratio records`);

    // Seed Default Schedule
    await ScheduleConfig.findOneAndUpdate(
      { key: 'default' },
      DEFAULT_SCHEDULE,
      { upsert: true, new: true }
    );
    console.log('Seeded default schedule config');

    console.log('\nDatabase seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Database seeding failed:', error);
    process.exit(1);
  }
}

seedDatabase();
