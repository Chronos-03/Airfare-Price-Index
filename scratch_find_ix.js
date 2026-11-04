require('dotenv').config();
const mongoose = require('mongoose');
const Fare = require('./backend/scraper/models/Fare');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const ix1050 = await Fare.find({ flightNumber: /IX1050/i }).lean();
  console.log('IX1050 records count:', ix1050.length);
  if (ix1050.length > 0) {
    console.log('Sample IX1050 record:', ix1050[0]);
  }

  const lowFares = await Fare.find({ totalFare: { $lt: 2000 }, dataQuality: 'VALID' }).limit(10).lean();
  console.log('Total low fares (< ₹2000) count:', await Fare.countDocuments({ totalFare: { $lt: 2000 } }));
  console.log('Sample low fares (< ₹2000):', lowFares);

  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
