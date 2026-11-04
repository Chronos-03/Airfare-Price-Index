require('dotenv').config();
const mongoose = require('mongoose');
const Fare = require('./backend/scraper/models/Fare');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log('Quarantining corrupted low fares (< ₹2500)...');
  const res1 = await Fare.updateMany(
    { totalFare: { $lt: 2500 } },
    { $set: { dataQuality: 'OUTLIER' } }
  );
  console.log('Quarantined sub-₹2,500 fares count:', res1.modifiedCount);

  // Fix IX1050 destination if set to BLR
  const res2 = await Fare.updateMany(
    { flightNumber: /IX1050/i, destination: 'BLR' },
    { $set: { destination: 'DEL', route: 'BOM-DEL' } }
  );
  console.log('Fixed IX1050 route to BOM-DEL count:', res2.modifiedCount);

  // Verify cleanest 10 fares sorted by totalFare
  const cleanest = await Fare.find({ dataQuality: 'VALID' })
    .sort({ totalFare: 1 })
    .limit(10)
    .select('flightNumber airline origin destination route travelDate advanceDays baseFare taxes udf totalFare')
    .lean();

  console.log('Cleanest top 10 fares in MongoDB Atlas:');
  cleanest.forEach(f => {
    console.log(`${f.flightNumber} (${f.airline}) | ${f.origin} -> ${f.destination} | Date: ${f.travelDate.toISOString().slice(0, 10)} | Window: T+${f.advanceDays} | Total: ₹${f.totalFare}`);
  });

  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
