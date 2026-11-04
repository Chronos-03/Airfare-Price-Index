require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const { connectDatabase } = require('./scraper/config/database');
const scraperFareRoutes = require('./scraper/routes/fares');
const dashboardRoutes = require('./routes/dashboard');
const apixRoutes = require('./routes/apix');
const arimaRoutes = require('./routes/arima');
const { apiCache } = require('./middleware/cache');
const { errorHandler, notFoundHandler } = require('./scraper/middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

// JSON body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS - allow configured origin(s)
app.use((req, res, next) => {
  const allowed = process.env.CORS_ORIGIN || '*';
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', allowed === '*' ? '*' : origin || allowed);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Serverless DB connection middleware ensuring active database connection for Vercel requests
app.use(async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    try {
      await connectDatabase();
    } catch (err) {
      console.error('Serverless DB connection warning:', err.message);
    }
  }
  next();
});

// Connect to MongoDB on startup
connectDatabase()
  .then(() => {
    console.log(`MongoDB connected: ${mongoose.connection.host}`);
    const Fare = require('./scraper/models/Fare');
    Fare.syncIndexes().catch((err) => console.log('Index sync warning:', err.message));
  })
  .catch((err) => {
    console.error(`MongoDB connection failed: ${err.message}`);
    console.error('The server will continue to run, but database features are unavailable.');
  });

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  res.json({
    status: dbState === 1 ? 'ok' : 'degraded',
    service: 'airfare-index',
    database: dbState === 1 ? 'connected' : `state=${dbState}`,
    time: new Date().toISOString()
  });
});

// Server-Sent Events (SSE) Live Real-Time Data Streaming Endpoint
const sseClients = new Set();

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (res.flushHeaders) res.flushHeaders();

  const connectedMsg = JSON.stringify({
    type: 'connected',
    message: 'SIH APIx Live SSE Stream Active',
    clientCount: sseClients.size + 1,
    timestamp: new Date().toISOString()
  });
  res.write(`data: ${connectedMsg}\n\n`);

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

function broadcastSSE(type, data) {
  const payload = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  for (const client of sseClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

const { saveFaresIdempotent } = require('./utils/fareStore');

// Helper to broadcast real scraped fares over SSE to connected frontend clients
function notifyLiveQuote(item) {
  if (sseClients.size > 0 && item) {
    broadcastSSE('quote_update', item);
  }
}

// High-speed response cache (15s TTL) for API GET endpoints
app.use('/api', apiCache(15000));

// Scraper API
app.use('/', scraperFareRoutes);

// Dashboard aggregate API
app.use('/api', dashboardRoutes);

// SIH APIx Airfare Price Index API
app.use('/api', apixRoutes);

// ARIMA Machine Learning Forecasting API
app.use('/api', arimaRoutes);

// Serve index.html fallback for client-side routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

if (require.main === module && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Airfare Index server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
