const mongoose = require('mongoose');

const fareSchema = new mongoose.Schema(
  {
    origin: { type: String, required: true, trim: true, uppercase: true },
    destination: { type: String, required: true, trim: true, uppercase: true },
    airline: { type: String, trim: true },
    flightNumber: { type: String, trim: true },
    travelDate: { type: Date },
    collectionDate: { type: Date },
    advanceDays: { type: Number, min: 0 },
    fareClass: { type: String, trim: true },
    baseFare: { type: Number, min: 0 },
    taxes: { type: Number, min: 0 },
    udf: { type: Number, min: 0 },
    convenienceFee: { type: Number, min: 0 },
    totalFare: { type: Number, min: 0 },
    availability: { type: String, trim: true },
    source: { type: String, trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Fare', fareSchema);
