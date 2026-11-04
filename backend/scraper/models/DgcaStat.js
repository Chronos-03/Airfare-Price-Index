'use strict';

const mongoose = require('mongoose');

/**
 * DgcaStat
 *
 * One document per (reportType | reportPeriod | airline) row from a parsed
 * DGCA monthly air-traffic report. 'TOTAL' is stored as a regular row so the
 * API can query airline-level and total shares uniformly.
 *
 * `dedupeKey` carries a unique (sparse) index so re-syncing the same period
 * upserts rather than duplicating rows. Shape mirrors the JSON lines written
 * by fileStore.writeDgcaReport().
 */
const dgcaStatSchema = new mongoose.Schema(
  {
    airline: { type: String, required: true, trim: true, uppercase: true },
    reportPeriod: { type: String, required: true, trim: true }, // 'YYYY-MM'
    reportType: { type: String, required: true, trim: true, uppercase: true },

    passengersCarried: { type: Number, min: 0 },
    passengersCarriedLakhs: { type: Number, min: 0 },
    marketSharePct: { type: Number, min: 0 },

    overall: { type: mongoose.Schema.Types.Mixed },

    reportTitle: { type: String, trim: true },
    reportUrl: { type: String, trim: true },

    source: { type: String, default: 'dgca', trim: true, lowercase: true },
    scrapedAt: { type: Date, default: Date.now },

    dedupeKey: { type: String, index: { unique: true, sparse: true } }
  },
  { timestamps: true }
);

dgcaStatSchema.index({ reportPeriod: 1, reportType: 1, airline: 1 });
dgcaStatSchema.index({ airline: 1 });

module.exports = mongoose.model('DgcaStat', dgcaStatSchema);