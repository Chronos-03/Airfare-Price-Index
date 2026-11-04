'use strict';

const mongoose = require('mongoose');

const heatmapWindowRatioSchema = new mongoose.Schema(
  {
    window: { type: String, required: true, trim: true },
    ratio: { type: Number, required: true, min: 0 },
    description: { type: String, trim: true }
  },
  { timestamps: true }
);

heatmapWindowRatioSchema.index({ window: 1 }, { unique: true });

module.exports = mongoose.model('HeatmapWindowRatio', heatmapWindowRatioSchema);
