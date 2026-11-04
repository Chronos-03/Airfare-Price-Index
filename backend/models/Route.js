const mongoose = require('mongoose');

const routeSchema = new mongoose.Schema(
  {
    origin: { type: String, required: true, trim: true, uppercase: true },
    destination: { type: String, required: true, trim: true, uppercase: true },
    weight: { type: Number, default: 1, min: 0 },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Route', routeSchema);
