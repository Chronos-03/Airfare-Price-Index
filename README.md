# Airfare Index (APIx)

**NSO (MoSPI) & RBI Retail Inflation & Price Intelligence Platform**

An integrated, production-grade web application and analytical engine that computes official consumer price inflation sub-indices for Indian domestic aviation. Scrapes real-time flight quotes from major carriers (**Air India**, **IndiGo**, **Akasa Air**, **SpiceJet**, **Air India Express**) and computes daily **Laspeyres**, **Paasche**, and **Fisher Ideal** geometric mean inflation indices for macro monetary policy.

```
Live Booking Engines (Playwright / IBE REST APIs)
   ↓  Proxy Mesh (5 Nodes) · Anti-Detection · SHA1 Dedupe
MongoDB Atlas  (flight_fares.fares)
   ↓
NSO Dual-Index & STL Seasonal Adjustment Engine (indexEngine.js)
   ↓
Express REST API  (/api/stats, /api/apix/dual-index, /api/capacity-weights...)
   ↓  fetch()
Frontend Dashboard  (Vanilla HTML5 / CSS3 / JS)
```

---

## Tech Stack & Architecture

| Layer | Technology |
|---|---|
| **Frontend** | HTML5, Vanilla CSS3, Vanilla JS (No heavy framework, custom SVG chart rendering) |
| **Backend** | Node.js, Express.js |
| **Analytical Engine** | NSO / MoSPI Dual-Index Engine (`indexEngine.js`), STL Seasonal Adjustment Filter |
| **Database** | MongoDB Atlas, Mongoose (SHA1 deduplication: `SHA1(origin|dest|date|airline|flightNo|class|source)`) |
| **Scraper & Infrastructure** | Hybrid Python Playwright + Node.js Adapters, Residential Proxy Rotation Mesh, Asynchronous Task Queue |
| **Utilities** | dotenv, cors, playwright, xlsx, pdf-parse |

---

## Core Analytical Features

1. **NSO / MoSPI Dual-Index Engine**:
   - **Laspeyres Price Index ($I_L$)**: Base-period passenger traffic weighted price index ($I_L = \frac{\sum P_t Q_0}{\sum P_0 Q_0} \times 100$).
   - **Paasche Price Index ($I_P$)**: Current-period passenger traffic weighted price index ($I_P = \frac{\sum P_t Q_t}{\sum P_0 Q_t} \times 100$).
   - **Fisher Ideal Geometric Mean Index ($I_F$)**: Official NSO (MoSPI) & RBI CPI transport inflation standard ($I_F = \sqrt{I_L \cdot I_P}$).

2. **STL Seasonal Decomposition Filter**:
   - Decomposes airfare time-series into Trend ($T_t$) and Day-of-Week/Festival Seasonal Factors ($S_t$), computing Seasonally Adjusted series ($SA_t = Y_t / S_t$) to filter holiday noise for RBI monetary policy modeling.

3. **DGCA Seat Capacity (ASK) & Load Factor (PLF) Carrier Weights**:
   - Integrates DGCA monthly Available Seat-Kilometers (ASK) and Passenger Load Factors (PLF) per carrier (`IndiGo 51.5%`, `Air India Group 23.8%`, `SpiceJet 13.1%`, `Akasa Air 11.6%`).

4. **Residential Proxy Mesh & Anti-Detection Architecture**:
   - 5 Indian regional proxy nodes (`IN-DEL`, `IN-BOM`, `IN-BLR`, `IN-CCU`, `IN-HYD`) with HTTP/2 TLS Client Hello fingerprints, WebGL vendor masking, and dynamic User-Agent rotation.

5. **Interactive Policy Scenario Simulator**:
   - Live multi-variable simulator on `analysis.html` featuring dual sliders for **DGCA Weight ($w_r$)** and **Simulated Price ($P_r$)**, real-time weighted impact points calculation (`+pts`), and quick policy presets (Festival Peak, ATF Fuel Spike, Monsoon Slump).

---

## Environment Variables

Copy `.env.example` to `.env` and adjust:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `5000` | HTTP port (serves frontend + API) |
| `MONGODB_URI` | `mongodb://localhost:27017/flight_fares` | MongoDB connection string |
| `MONGO_WRITE_ENABLED` | `true` | Persist scraped fares to MongoDB |
| `JSON_EXPORT_ENABLED` | `true` | Write JSON/JSONL export files |
| `JSON_EXPORT_DIR` | `./output` | Export directory |
| `CORS_ORIGIN` | `*` | Allowed CORS origin(s) |

---

## Running the Application

Start the backend server (also serves the static frontend):

```bash
npm start
# or: node backend/server.js
```

Open your browser:

- `http://localhost:5000/`             - Dashboard
- `http://localhost:5000/routes.html`  - Route Analysis
- `http://localhost:5000/analysis.html`- Analytics & Policy Simulator
- `http://localhost:5000/data.html`    - Data Monitor
- `http://localhost:5000/docs.html`    - Technical Documentation & Interactive API Console

---

## REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | System health & MongoDB connection status |
| `GET` | `/api/stats` | Aggregated dashboard metrics (KPIs, route overview, lead-time, carrier comparison) |
| `GET` | `/api/apix` | APIx Index Trend & Sector Weights |
| `GET` | `/api/apix/dual-index` | NSO/MoSPI Laspeyres, Paasche, and Fisher Ideal Dual-Index series |
| `GET` | `/api/apix?seasonal=true` | Seasonally-Adjusted (SA) Core Inflation Index |
| `GET` | `/api/capacity-weights` | DGCA seat capacity (ASK) & load factor (PLF) carrier weight distributions |
| `GET` | `/api/heatmap` | Route sector fare matrix |
| `GET` | `/api/elasticity` | Lead-time advance purchase elasticity curve (T+1 to T+45) |
| `GET` | `/api/airlines` | Airline fare averages and market share breakdown |
| `GET` | `/api/scrape/mesh/status` | Active residential proxy node mesh health |
| `GET` | `/api/scrape/queue/status` | Active scraper worker queue status |
| `POST` | `/api/scrape/queue/dispatch` | Dispatch asynchronous scrape job to queue |
| `GET` | `/api/nso-export` | NSO / MoSPI format official monthly CPI report |
| `GET` | `/api/backtest` | 30-Day back-tested DGCA verification data |
| `GET` | `/api/fares` | Filtered fare query endpoint |

---

## Running Scrapers via CLI

```bash
# Scrape single route for Air India
python -m backend.scraper_python.cli --source airindia --origin DEL --destination BOM --date 2026-09-15

# Scrape all carriers (Air India, IndiGo, Akasa, SpiceJet)
python -m backend.scraper_python.cli --source airindia,indigo,akasa,spicejet --origin DEL --destination BOM --date 2026-09-15

# Run Master 30-Day Full Route Batch Suite
python -u backend/scripts/run_30_day_unbuffered.py
```
