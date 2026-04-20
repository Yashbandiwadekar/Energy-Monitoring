# PZEM Telemetry Console

A real-time, industrial SCADA-style dashboard for monitoring single-phase AC power using a PZEM-004T v3 meter, an ESP32, HiveMQ Cloud, PostgreSQL, and a React frontend — with optional AI-powered operational insights via OpenRouter.

![stack](https://img.shields.io/badge/stack-ESP32%20%7C%20MQTT%20%7C%20Node-blue)
![frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite%20%2B%20Tailwind-0ea5e9)
![database](https://img.shields.io/badge/db-PostgreSQL%2016-336791)

---

## What this is

A complete end-to-end pipeline:

```
┌───────────┐   MQTT/TLS    ┌─────────────┐   socket.io   ┌──────────────┐
│  ESP32 +  │ ────────────► │   Node.js   │ ────────────► │  React SCADA │
│ PZEM-004T │   (HiveMQ)    │   Backend   │               │   Dashboard  │
└───────────┘               │  (Express)  │               └──────────────┘
                            │     │       │
                            │     ▼       │
                            │ PostgreSQL  │
                            │ (Docker)    │
                            │     │       │
                            │     ▼       │
                            │ OpenRouter  │ (optional AI insights)
                            └─────────────┘
```

**Features:**
- Live KPI cards (voltage, current, power, power factor) with conditional formatting
- Responsive Recharts area chart with 5M / 1H / 24H / 7D historical ranges
- Server-side downsampling for wide time windows
- Cumulative energy, mains frequency gauge, event log
- CSV export of chart buffer
- Configurable alarm thresholds via in-app modal
- AI Insights panel — automatic anomaly/trend/efficiency analysis (free-tier OpenRouter)
- Seed script for visual testing without real hardware

---

## Repository layout

```
pzem-dashboard/
├── backend/
│   ├── server.js          # Express + MQTT + Socket.io + AI proxy
│   ├── schema.sql         # PostgreSQL time-series schema
│   ├── seed.js            # Synthetic telemetry generator (7 days default)
│   ├── package.json
│   └── .env               # Created from .env.example
├── frontend/
│   ├── src/
│   │   ├── PowerMonitoringDashboard.jsx
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── package.json
│   └── .env               # VITE_API_BASE only
└── .gitignore             # Covers both subprojects
```

---

## Prerequisites

Install these once on your machine:

| Tool | Version | Purpose |
|---|---|---|
| **Node.js** | 18+ (20 LTS recommended) | Runs backend and Vite dev server |
| **Docker Desktop** | latest | Hosts the PostgreSQL container |
| **Git** | any | Cloning / version control |

Optional:
- An ESP32 flashed with a PZEM-004T publisher sketch targeting your HiveMQ Cloud broker
- A [HiveMQ Cloud](https://www.hivemq.com/mqtt-cloud-broker/) free serverless cluster
- An [OpenRouter](https://openrouter.ai/) account for AI insights (free)

You do **not** need the ESP32 to try the dashboard — the seed script generates realistic synthetic data.

---

## Quick start (five commands)

Clone the repo, then from the project root:

```bash
# 1. Start PostgreSQL in Docker
docker run --name pzem-pg -e POSTGRES_PASSWORD=mysecret -e POSTGRES_DB=pzem_db -p 5432:5432 -d postgres:16

# 2. Load the schema
docker exec -i pzem-pg psql -U postgres -d pzem_db < backend/schema.sql

# 3. Install backend deps, configure, and optionally seed fake data
cd backend && npm install && cp .env.example .env      # edit .env — see below
npm run seed:clear                                      # optional: 7 days of synthetic data
npm run dev                                             # leave this running

# 4. In a second terminal, install and run the frontend
cd frontend && npm install && echo "VITE_API_BASE=http://localhost:4000" > .env
npm run dev                                             # opens http://localhost:5173
```

Open `http://localhost:5173` — you should see the dashboard. If you seeded data in step 3, the chart will populate immediately.

---

## Detailed setup

### 1. PostgreSQL (Docker)

Start a local Postgres 16 container. Change `mysecret` if you want a different password — just remember to update `.env` to match:

```bash
docker run --name pzem-pg \
    -e POSTGRES_PASSWORD=mysecret \
    -e POSTGRES_DB=pzem_db \
    -p 5432:5432 \
    -d postgres:16
```

**Container lifecycle:**

```bash
docker ps                    # check it's running
docker stop pzem-pg          # pause when you're done
docker start pzem-pg         # resume (data persists)
docker rm -f pzem-pg         # delete container AND data — rarely what you want
```

**Load the schema** (one time, or again any time you want to reset):

```bash
docker exec -i pzem-pg psql -U postgres -d pzem_db < backend/schema.sql
```

You should see `CREATE TABLE`, two `CREATE INDEX`, and `ALTER TABLE`. Verify:

```bash
docker exec -it pzem-pg psql -U postgres -d pzem_db -c "\dt"
```

You want to see `pzem_telemetry` in the table list.

> **No `psql` on your Windows machine?** That's fine — `docker exec` runs `psql` *inside* the container, so you never need to install the Postgres client on your host OS.

### 2. Backend (Node.js / Express)

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env` — at minimum you need Postgres values (already correct if you used `mysecret` above) and your HiveMQ credentials. The AI block is optional:

```ini
# ---- HTTP ----
PORT=4000
CORS_ORIGIN=http://localhost:5173

# ---- PostgreSQL (matches the Docker container) ----
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=mysecret
PGDATABASE=pzem_db
PGSSL=false

# ---- HiveMQ Cloud ----
MQTT_HOST=your-cluster-id.s1.eu.hivemq.cloud
MQTT_PORT=8883
MQTT_USERNAME=your_hivemq_user
MQTT_PASSWORD=your_hivemq_password
MQTT_TOPIC=pzem/device01/telemetry

# ---- OpenRouter AI (optional; leave key blank to disable) ----
OPENROUTER_API_KEY=
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
INSIGHT_INTERVAL_MINUTES=15
```

**Run the server:**

```bash
npm run dev     # auto-restart on file changes
# or
npm start       # plain node
```

Expected startup output:

```
[PG] Connected. Server time: 2026-04-20T...
[HTTP] Listening on :4000
[HTTP] CORS origin:  http://localhost:5173
[MQTT] Connected to mqtts://...
[MQTT] Subscribed: pzem/device01/telemetry
[AI] Insights enabled — model=..., interval=15 min.
```

Health check:

```bash
curl http://localhost:4000/healthz
```

### 3. Seed synthetic data (optional but recommended)

Without real hardware, or just to see 24H / 7D views populated, run the seed script from the `backend/` folder:

```bash
npm run seed:clear       # wipes existing rows for esp32_pzem_01, seeds 7 days
npm run seed             # adds 7 days of data without clearing
node seed.js --days=14   # custom: 14 days
node seed.js --days=30 --clear
```

Takes ~5 seconds for 7 days (~60,480 rows at 10 s cadence). The generator produces realistic profiles: idle overnight, morning ramp, evening peaks, fridge cycling, occasional appliance spikes, weekend vs weekday differences.

### 4. Frontend (React / Vite)

```bash
cd frontend
npm install
echo "VITE_API_BASE=http://localhost:4000" > .env
npm run dev
```

Vite prints a URL — by default `http://localhost:5173`. Open it.

If the backend is running and the DB has data, you should see:
- The KPI cards lit up with live or seeded values
- The chart populated (try the 5M / 1H / 24H / 7D toggle)
- The event log showing connection and data-load entries
- The AI Insights panel either showing "AWAITING FIRST ANALYSIS CYCLE" (if you just started) or eventually displaying structured output (~60 s after backend start)

### 5. Hardware side (ESP32 + PZEM-004T)

The dashboard expects JSON packets published to your `MQTT_TOPIC` every ~10 seconds with this exact shape:

```json
{
    "device": "esp32_pzem_01",
    "voltage_V": 236.40,
    "current_A": 0.145,
    "power_W": 34.22,
    "energy_Wh": 128.55,
    "frequency_Hz": 50.02,
    "power_factor": 0.98
}
```

Wiring notes (TTL version of the PZEM-004T v3):
- PZEM **TX** → ESP32 RX (typically GPIO 16)
- PZEM **RX** → ESP32 TX (typically GPIO 17)
- PZEM **5V** and **GND** from a clean 5V source

Keep jumper wires **short**, twist TX/RX with a ground return, and add a 100 nF decoupling cap near the PZEM's TTL header. For longer runs or noisy environments, use the RS485 version of the PZEM with MAX485 transceivers on each end of a twisted pair.

---

## AI Insights setup (optional)

1. Sign up at [openrouter.ai](https://openrouter.ai) (free, no billing required).
2. Create a key at openrouter.ai/keys.
3. Paste it into `backend/.env` as `OPENROUTER_API_KEY=sk-or-v1-...`
4. Restart the backend.

The first analysis runs ~60 s after startup, then every `INSIGHT_INTERVAL_MINUTES` (default 15). One API call serves all connected dashboards.

**If you hit rate limits** (the free Llama endpoint is shared globally), swap the model:

```ini
OPENROUTER_MODEL=deepseek/deepseek-chat-v3.1:free
# or
OPENROUTER_MODEL=google/gemini-2.0-flash-exp:free
```

For production-grade quota, get a free [Groq](https://console.groq.com) API key and add it to OpenRouter under Settings → Integrations — free Llama 3.3 via Groq is ~14,400 requests/day, vs ~200 on the shared pool.

---

## Daily workflow

Once everything's installed, a normal session looks like:

```bash
# Start PG (if stopped)
docker start pzem-pg

# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open `http://localhost:5173`.

When you're done:

```bash
# Ctrl-C both dev servers
docker stop pzem-pg
```

---

## REST API reference

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/healthz` | Liveness probe — MQTT & AI status, connected WS clients |
| `GET`  | `/api/history?range=5M\|1H\|24H\|7D&device=<id>` | Historical samples, downsampled for wide ranges |
| `GET`  | `/api/insights` | Latest cached AI analysis + config |
| `POST` | `/api/insights/run` | Force an immediate AI cycle (respects in-flight lock) |

**WebSocket events** (Socket.io):

| Event | Payload |
|---|---|
| `telemetry` | Newly-persisted packet, enriched with `id`, `timestamp`, `time` |
| `ai-insight` | Full structured analysis (summary / anomalies / trends / tips) |
| `ai-insight-error` | `{ error, generatedAt }` when an AI cycle fails |

---

## Troubleshooting

**Backend: `[PG] Startup connectivity check FAILED: password authentication failed`**
Your `PGPASSWORD` in `.env` doesn't match the one you gave Docker. Either fix `.env` or recreate the container with the right password.

**Backend: `[MQTT] Error: Connection refused: Not authorized`**
HiveMQ credentials wrong, or your HiveMQ cluster is paused. Log into HiveMQ Cloud, check the cluster is running and the credential pair exists.

**Frontend: chart is blank, KPIs show `NaN` or zeros**
- DB is empty — run `npm run seed:clear` from backend/ to populate synthetic data.
- Backend not reachable — open DevTools, look for a failed `/api/history` call. Check `VITE_API_BASE` matches the backend's actual port.

**Frontend: `[WS] Connect error: xhr poll error`**
CORS mismatch. `CORS_ORIGIN` in `backend/.env` must exactly equal the URL Vite prints (usually `http://localhost:5173`). No trailing slash.

**AI panel: `openrouter_http_429: Provider returned error`**
The free Llama pool is saturated. Swap `OPENROUTER_MODEL` to `deepseek/deepseek-chat-v3.1:free` and restart.

**AI panel stays in "AWAITING FIRST ANALYSIS CYCLE"**
Either `OPENROUTER_API_KEY` is unset (check the backend startup log for `[AI] Insights disabled`), or the DB has fewer than 3 samples in the last hour. Seed data or wait.

**`docker: command not found`**
Docker Desktop isn't running or isn't installed. Start it (Windows/Mac) or install it.

**Container exists but won't start: `port is already allocated`**
Something else is on 5432. Either stop the other Postgres (`net stop postgresql-x64-16` on Windows, or kill the conflicting process) or map a different port: `-p 5433:5432` and update `PGPORT=5433`.

---

## Scripts reference

**Backend (`backend/package.json`):**

```bash
npm run dev           # node --watch server.js
npm start             # node server.js
npm run seed          # seed 7 days, keep existing
npm run seed:clear    # wipe + seed 7 days
```

**Frontend (`frontend/package.json`):**

```bash
npm run dev           # Vite dev server with HMR
npm run build         # production build → dist/
npm run preview       # serve the built bundle locally
npm run lint          # ESLint
```

---

## Security checklist before pushing to GitHub

- [ ] `.env` files are in `.gitignore` (already handled at repo root)
- [ ] HiveMQ credentials aren't committed in any file
- [ ] OpenRouter API key isn't committed
- [ ] Postgres password is rotated if you ever pushed a test commit with it

Run `git status` before your first commit and confirm no `.env` files appear.

---

## Stack credits

- **React 19 + Vite 8** — frontend framework and build tool
- **Tailwind CSS 3** — utility-first styling
- **Recharts** — time-series chart
- **Lucide** — icons
- **Socket.io** — realtime WebSocket transport
- **mqtt.js** — MQTT client with TLS
- **Express + pg** — backend HTTP and Postgres driver
- **PostgreSQL 16** — time-series storage with BRIN indexing
- **OpenRouter** — LLM gateway for AI insights

---