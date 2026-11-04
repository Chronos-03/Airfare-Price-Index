'use strict';

const mongoose = require('mongoose');

const AVAILABILITY = [
  'AVAILABLE',
  'SOLD_OUT',
  'CANCELLED',
  'NOT_FOUND',
  'SCRAPE_ERROR',
  'INVALID'
];

const DATA_QUALITY = ['VALID', 'OUTLIER', 'INVALID', 'DUPLICATE'];

const fareSchema = new mongoose.Schema(
  {
    origin: { type: String, required: true, trim: true, uppercase: true },
    destination: { type: String, required: true, trim: true, uppercase: true },

    route: { type: String, trim: true, uppercase: true },

    airline: { type: String, trim: true },
    flightNumber: { type: String, trim: true },

    travelDate: { type: Date, required: true },
    collectionDate: { type: Date },

    advanceDays: { type: Number, min: 0 },

    fareClass: { type: String, trim: true },

    baseFare: { type: Number, min: 0 },
    taxes: { type: Number, min: 0 },
    udf: { type: Number, min: 0 },
    convenienceFee: { type: Number, min: 0 },

    totalFare: { type: Number, min: 0 },
    currency: { type: String, default: 'INR', trim: true, uppercase: true },

    availability: {
      type: String,
      enum: AVAILABILITY,
      default: 'AVAILABLE'
    },

    source: { type: String, trim: true, lowercase: true },
    scrapedAt: { type: Date, default: Date.now },

    dataQuality: {
      type: String,
      enum: DATA_QUALITY,
      default: 'VALID'
    },

    /**
     * Source-specific context attached post-normalization (spec #25).
     *
     * normalizeRawFare() intentionally drops unknown fields so no fabricated
     * data can leak in; adapters that read REAL response payloads attach the
     * verified details here (flight schedule, fare buckets, report period ...).
     * Stored as Mixed so each source can keep its own faithfully-observed shape.
     */
    metric: { type: mongoose.Schema.Types.Mixed },

    /**
     * Internal deduplication key. Not part of the original canonical schema,
     * but REQUIRED to implement the "prefer an appropriate MongoDB
     * unique/index strategy" deduplication requirement (#13).
     *
     * It is a deterministic digest of the identifying fields:
     *   origin | destination | travelDate | airline | flightNumber |
     *   fareClass | source
     *
     * The unique index lives on this field so re-scraping the same
     * flight/fare-class/date/source cannot silently create a second row.
     * See src/services/duplicateDetector.js.
     */
    dedupeKey: { type: String, index: { unique: true, sparse: true } }
  },
  { timestamps: true, strict: false }
);

// Canonical query indexes from the spec
fareSchema.index({ origin: 1, destination: 1, travelDate: 1, source: 1 });
fareSchema.index({ route: 1 });

// Convenience index for the API query layer
fareSchema.index({ travelDate: 1 });
fareSchema.index({ airline: 1, fareClass: 1, availability: 1, dataQuality: 1 });
fareSchema.index({ totalFare: 1 });

fareSchema.virtual('id').get(function getVirtualId() {
  return this._id ? this._id.toString() : null;
});

fareSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    delete ret._id;
    return ret;
  }
});

module.exports = mongoose.model('Fare', fareSchema);
module.exports.AVAILABILITY = AVAILABILITY;
module.exports.DATA_QUALITY = DATA_QUALITY;