'use strict';

const mongoose = require('mongoose');

const basketWeightSchema = new mongoose.Schema(
  {
    route: { type: String, required: true, trim: true, uppercase: true },
    weight: { type: Number, required: true, min: 0, max: 100 },
    baseFare: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

basketWeightSchema.index({ route: 1 }, { unique: true });

module.exports = mongoose.model('BasketWeight', basketWeightSchema);
