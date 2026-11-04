'use strict';

const mongoose = require('mongoose');

const scheduleLogSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, required: true, default: Date.now },
    status: { type: String, required: true, enum: ['SUCCESS', 'FAILED', 'PARTIAL'], trim: true },
    routesScraped: { type: Number, default: 0, min: 0 },
    quotesExtracted: { type: Number, default: 0, min: 0 },
    durationSec: { type: Number, default: 0, min: 0 },
    errorMessage: { type: String, trim: true }
  },
  { timestamps: true }
);

scheduleLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('ScheduleLog', scheduleLogSchema);
