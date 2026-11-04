'use strict';

/**
 * Date helpers.
 *
 * Consistency strategy: all date arithmetic in this project is performed on
 * UTC calendar days. A travel date like "2026-09-15" is stored as midnight
 * UTC (`new Date('2026-09-15T00:00:00.000Z')`). Otherwise DST/local-time
 * offsets would make `advanceDays` off by one.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse a travel/collection date into a UTC midnight Date.
 *
 * Accepts:
 *   - a JS Date
 *   - an ISO string such as '2026-09-15' or '2026-09-15T10:00:00.000Z'
 *
 * Date-only strings ('2026-09-15') are interpreted as a UTC date (NOT local).
 *
 * @param {Date|string} value
 * @returns {Date}
 * @throws {TypeError} if the value cannot be parsed
 */
function parseUtcDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError(`Invalid date: ${String(value)}`);
    }
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
    );
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Normalize a bare YYYY-MM-DD into an explicit UTC instant so `new Date()`
    // does not interpret it as local time.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    const iso = dateOnly
      ? `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00.000Z`
      : trimmed;

    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
      throw new TypeError(`Invalid date string: ${value}`);
    }
    return new Date(
      Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
    );
  }

  throw new TypeError(`Invalid date value: ${String(value)}`);
}

/**
 * Advance booking days between a collection date and a travel date.
 *
 * advanceDays = travelDate - collectionDate, as whole UTC days.
 * A 0 or negative result (travel on/before collection) is allowed so callers
 * can detect and flag nonsensical data.
 *
 * @param {Date|string} travelDate
 * @param {Date|string} collectionDate
 * @returns {number}
 */
function computeAdvanceDays(travelDate, collectionDate) {
  const travel = parseUtcDate(travelDate);
  const collection = parseUtcDate(collectionDate);
  return Math.round((travel.getTime() - collection.getTime()) / DAY_MS);
}

/**
 * Format a Date (or date string) as YYYY-MM-DD in UTC.
 *
 * @param {Date|string} value
 * @returns {string}
 */
function formatUtcDate(value) {
  const d = parseUtcDate(value);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * ISO date string used by the Fare.travelDate field (midnight UTC).
 *
 * @param {Date|string} value
 * @returns {Date}
 */
function toTravelDate(value) {
  return parseUtcDate(value);
}

module.exports = {
  DAY_MS,
  parseUtcDate,
  computeAdvanceDays,
  formatUtcDate,
  toTravelDate
};