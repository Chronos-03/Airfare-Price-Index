'use strict';

require('dotenv').config();
const { connectDatabase } = require('../scraper/config/database');
const Fare = require('../scraper/models/Fare');

async function check() {
  await connectDatabase();

  const dupes = await Fare.aggregate([
    { $group: { _id: '$dedupeKey', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]);

  console.log('DUPLICATES COUNT:', dupes.length);

  const origins = await Fare.distinct('origin');
  const destinations = await Fare.distinct('destination');
  const routes = await Fare.distinct('route');

  console.log('Distinct Origins:', origins);
  console.log('Distinct Destinations:', destinations);
  console.log('Distinct Routes:', routes);

  process.exit(0);
}

check().catch(console.error);
