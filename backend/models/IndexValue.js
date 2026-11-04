const mongoose = require('mongoose');

const indexValueSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    route: { type: String, trim: true, uppercase: true },
    averageFare: { type: Number, min: 0 },
    indexValue: { type: Number }
  },
  { timestamps: true }
);

module.exports = mongoose.model('IndexValue', indexValueSchema);
