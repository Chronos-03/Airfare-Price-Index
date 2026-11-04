'use strict';

const mongoose = require('mongoose');

const backtestBenchmarkSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    route: { type: String, default: 'ALL', trim: true, uppercase: true },
    benchmarkAvgFare: { type: Number, required: true, min: 0 },
    source: { type: String, default: 'DGCA', trim: true }
  },
  { timestamps: true }
);

backtestBenchmarkSchema.index({ date: 1, route: 1 }, { unique: true });

module.exports = mongoose.model('BacktestBenchmark', backtestBenchmarkSchema);
