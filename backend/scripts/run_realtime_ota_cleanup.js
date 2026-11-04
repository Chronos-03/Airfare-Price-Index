'use strict';

const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const Fare = require('../scraper/models/Fare');
const { runRealtimeOtaCleanup } = require('../services/otaValidator');

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/airfare_index';
  console.log('Connecting to MongoDB Atlas for Real-time OTA Data Cleanup...');
  await mongoose.connect(mongoUri);

  console.log('Running Real-time OTA Data Verification & Cleanup Engine...');
  const result = await runRealtimeOtaCleanup(Fare);

  console.log(`=== REAL-TIME OTA DATA CLEANUP RESULTS ===`);
  console.log(`Total Documents Scanned: ${result.scannedCount}`);
  console.log(`Bad / Incorrect Documents Purged: ${result.purgedCount}`);

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB. Real-time cleanup finished with 100% success.');
}

main().catch(err => {
  console.error('Real-time OTA Cleanup failed:', err);
  process.exit(1);
});
