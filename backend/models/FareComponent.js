'use strict';

const mongoose = require('mongoose');

const fareComponentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ['UDF', 'CONVENIENCE_FEE'],
      trim: true
    },
    airportCode: { type: String, trim: true, uppercase: true },
    airline: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR', trim: true, uppercase: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

fareComponentSchema.index({ type: 1, airportCode: 1 }, { unique: true, sparse: true });
fareComponentSchema.index({ type: 1, airline: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('FareComponent', fareComponentSchema);
