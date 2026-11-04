'use strict';

const mongoose = require('mongoose');

const capacityWeightSchema = new mongoose.Schema(
  {
    airline: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    askMillionKm: { type: Number, min: 0 },
    plfPct: { type: Number, min: 0, max: 100 },
    capacityWeightPct: { type: Number, min: 0, max: 100 },
    period: { type: String, trim: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

capacityWeightSchema.index({ airline: 1, period: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('CapacityWeight', capacityWeightSchema);
