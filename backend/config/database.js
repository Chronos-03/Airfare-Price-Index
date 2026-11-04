const mongoose = require('mongoose');

/**
 * Connect to MongoDB using the connection string from process.env.MONGODB_URI.
 *
 * The server is designed to start and remain reachable (e.g. for /health)
 * even when MongoDB is unavailable. Connection failures are reported
 * gracefully via logs and the Mongoose connection 'error' event rather than
 * crashing the process.
 */
const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('WARN: MONGODB_URI is not defined. Database features will be unavailable.');
    return null;
  }

  mongoose.connection.on('connected', () => {
    console.log(`MongoDB connected: ${mongoose.connection.host}`);
  });

  mongoose.connection.on('error', (err) => {
    console.error(`MongoDB connection error: ${err.message}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected.');
  });

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000
    });
    return conn;
  } catch (error) {
    console.error(`MongoDB connection failed: ${error.message}`);
    console.error('The server will continue to run, but database features are unavailable.');
    return null;
  }
};

module.exports = connectDB;
