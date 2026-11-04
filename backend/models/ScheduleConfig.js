'use strict';

const mongoose = require('mongoose');

const scheduleConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, default: 'default', trim: true },
    frequency: { type: String, default: 'daily', trim: true },
    time: { type: String, default: '06:00 AM IST', trim: true },
    active: { type: Boolean, default: true },
    nextRun: { type: Date },
    lastRun: { type: Date }
  },
  { timestamps: true }
);

scheduleConfigSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model('ScheduleConfig', scheduleConfigSchema);
