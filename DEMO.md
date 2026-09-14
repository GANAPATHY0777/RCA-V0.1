# Evidence-Based AI Root Cause Analysis — Demo Runbook

This guide contains step-by-step instructions with exact `curl` and UI actions to demonstrate the full end-to-end capabilities of the Evidence-Based AI Root Cause Analysis MVP.

---

## Architecture & Ports Quick Reference

| Service | Port | Description |
|---|---|---|
| **RCA Control Room (Dashboard)** | `http://localhost:3030` | Single-screen control room UI |
| **Frontend Gateway** | `http://localhost:3000` | Ingress gateway + proxy |
| **Order Service** | `http://localhost:3001` | Order processing |
| **Payment Service** | `http://localhost:3002` | Payment handling + Postgres access |
| **Auth Service** | `http://localhost:3003` | Token verification |
| **Anomaly Detector** | `http://localhost:3010` | Python rolling z-score detector |
| **Analysis Engine** | `http://localhost:3020` | Graph builder, correlation, Claude AI, recovery |
| **OpenTelemetry Collector** | `http://localhost:4318` | OTLP traces & metrics receiver |
| **PostgreSQL** | `localhost:5432` | Relational state & telemetry store |

---

## Step 1: Start System and Verify Initial Health

### 1.1 Start Docker Compose

```bash
docker-compose up --build -d
```

*(Optional: Set your Anthropic API Key before starting if you want Claude Sonnet 5 reasoning; otherwise, the system seamlessly uses the grounded rule-based fallback)*:
```bash
# Windows PowerShell
$env:ANTHROPIC_API_KEY="sk-ant-..."
docker-compose up -d
```

### 1.2 Verify Service Health

Run the following command to check aggregated health:

```bash
curl -s http://localhost:3020/api/services/health
```

Expected output:
```json
{
  "overall": "healthy",
  "services": [
    {"name": "frontend-gateway", "status": "healthy"},
    {"name": "order-service", "status": "healthy"},
    {"name": "payment-service", "status": "healthy"},
    {"name": "auth-service", "status": "healthy"},
    {"name": "postgres", "status": "healthy"}
  ]
}
```

### 1.3 Open the Dashboard

Open your browser to:
```
http://localhost:3030
```
- Status bar displays: `All systems operational` with live UTC clock.
- Dependency topology shows all 5 nodes green (`#5FBF77`) with real trace-derived edges.
- Incident panel displays: `No Active Incidents`.

---

## Step 2: Trigger Fault A (DB Latency on Payment Service)

### 2.1 Inject Fault A

Inject a 2000ms database delay into `payment-service` (via gateway or Demo Controls button):

```bash
curl -X POST http://localhost:3000/api/faults/db-latency \
  -H "Content-Type: application/json" \
  -d '{"delay_ms": 2000}'
```

Or click **"Trigger Fault A · DB Latency"** in the dashboard bottom bar.

### 2.2 Observe Telemetry & Anomaly Detection

- Within 10–25 seconds, traffic through the order flow accumulates latency.
- The Python Anomaly Detector detects `request_latency_ms` exceeding the 3.0 z-score threshold (typically z > 5.0).
- Anomaly events appear in the **Evidence Timeline** horizontal strip.

### 2.3 Observe Root Cause Attribution & Baseline Comparison

- In the **Incident Panel**:
  - Identified Root Cause: **`payment-service`** (or `postgres` connection pool)
  - Confidence %: High (e.g., `85%`–`92%`), derived from:
    $$\text{score} = 0.35 \times \text{temporal} + 0.40 \times \text{dependency} + 0.25 \times \text{severity}$$
  - AI Reasoning (Claude Sonnet 5 / grounded engine): Explains that while `frontend-gateway` and `order-service` experienced downstream timeouts, the dependency path and extreme z-score confirm `payment-service` as the root cause.
- In the **Comparison Strip**:
  - **Evidence-Based Engine**: Correctly identifies `payment-service`.
  - **Naive Baseline (First-Arrival)**: Incorrectly blames `frontend-gateway` (or whichever symptom happened to register first at the edge).
  - The disagreement is visible side-by-side!

---

## Step 3: Approve Recovery & Verify Healing (Fault A)

### 3.1 Approve via UI or API

In the Incident Panel, click **"Approve Recovery Action"** (or run):

```bash
# Retrieve active incident ID
INCIDENT_ID=$(curl -s http://localhost:3020/api/incidents/active | jq -r .id)

# Approve recovery action
curl -X POST http://localhost:3020/api/incidents/$INCIDENT_ID/approve \
  -H "Content-Type: application/json" \
  -d '{"user": "demo-operator"}'
```

### 3.2 Observe Container Restart & Automated Health Check

1. The Analysis Engine invokes the Docker Engine API to restart the `payment-service` container.
2. The UI recovery status updates: `"Restart initiated. Polling health endpoint every 2s (up to 30s)..."`.
3. When health check returns HTTP 200:
   - Status changes to `healthy`.
   - **Deliberate motion transition:** Node color smoothly animates from red (`#E5484D`) to green (`#5FBF77`) over 1.2 seconds (`transition: fill 1.2s ease-in-out`).
   - Incident panel fades out cleanly.

---

## Step 4: Reset Telemetry & Fault State

Reset all active faults to ensure a clean baseline:

```bash
curl -X POST http://localhost:3000/api/faults/reset
```

Or click **"Reset Faults"** in the dashboard bottom bar.

---

## Step 5: Trigger Fault B (Memory / CPU Leak on Auth Service)

### 5.1 Inject Fault B

Inject a simulated memory leak into `auth-service` (completely independent dependency path from Postgres):

```bash
curl -X POST http://localhost:3000/api/faults/auth-memory-leak \
  -H "Content-Type: application/json" \
  -d '{"rate_mb_per_sec": 10}'
```

Or click **"Trigger Fault B · Memory Leak"** in the dashboard bottom bar.

### 5.2 Observe Divergent Attribution

- Notice the dependency path: `frontend-gateway` → `auth-service`.
- Neither `order-service`, `payment-service`, nor `postgres` are affected.
- In the **Incident Panel**:
  - Identified Root Cause: **`auth-service`**
  - Metric: `process_memory_rss_mb` or `process_cpu_percent`
  - Formula correctly computes zero dependency path to `order-service` / `payment-service`.
  - Confidence % updates to reflect the single-path deviation.

### 5.3 Approve Recovery & Verify Healing (Fault B)

Click **"Approve Recovery Action"** in the Incident Panel:
- `auth-service` container restarts.
- Memory returns to clean baseline (~40MB).
- Graph node turns green with 1.2s transition.

---

## Step 6: Interactive Operator Mode (Human-Driven RCA)

Operator Mode shifts the platform from passive demonstration to an interactive game and testing suite where human operators generate load, tune fault sliders, diagnose incidents before AI reveals its answer, and compete against the clock.

### 6.1 Level 1 (Guided Mode Run)

1. **Set Difficulty Level**:
   In the bottom **Operator Controls** bar, click **"L1 · Guided (60s)"**.
2. **Spawn Live Load**:
   Click the **"Spawn Order"** button 3–5 times. Notice the `Live Session Orders` counter incrementing in real time.
3. **Configure Fault Intensity Slider**:
   Slide the **Fault A: DB Latency** slider to `3500 ms` (or any value between 500ms and 5000ms).
4. **Trigger Fault A**:
   Click **"Trigger Fault A (3500ms)"**.
   ```bash
   curl -X POST http://localhost:3000/api/faults/db-latency \
     -H "Content-Type: application/json" \
     -d '{"delay_ms": 3500}'
   ```
5. **Diagnose Before Reveal**:
   - The incident enters the `awaiting_diagnosis` state.
   - An instrument-style countdown timer starts ticking down from `01:00`.
   - **Zero-Leak Guarantee**: The root cause, confidence score, and AI reasoning are completely hidden and redacted from the API response payload. Recovery approval is locked.
   - Look at the **Evidence Timeline** and **Dependency Topology**.
6. **Submit Your Diagnosis via Node-Click**:
   Click directly on the **`payment-service`** node inside the **Dependency Topology** graph.
7. **Observe Reveal & AI Verdict**:
   - A verdict banner appears at the top:
     `✓ CORRECT — YOU FOUND IT IN 8.4s · Identified actual root cause payment-service`
   - The full AI reasoning (Signal Blue `#5B8DEF`), candidate scoring breakdown with weights (`0.35 * temporal + 0.40 * dependency + 0.25 * severity`), and Naive Baseline comparison are revealed.
8. **Approve Recovery**:
   Click **"Approve Recovery Action"**. The container restarts and health is verified within 30s.
9. **Inspect Scoreboard**:
   Check the persistent **Scoreboard** in the top header:
   `DIAGNOSED: 1 | ACCURACY: 100% | STREAK: +1`

---

### 6.2 Level 2 (Ambiguous Mode Run)

1. **Set Level 2**:
   Click **"L2 · Ambiguous (30s)"**.
   This temporarily lowers downstream anomaly detection thresholds ($z \ge 1.5$), so `order-service` and `frontend-gateway` alert alongside `payment-service`.
2. **Trigger Fault A**:
   Click **"Trigger Fault A"**.
3. **Reason on Topology**:
   Multiple nodes turn red/warning. Reason along the dependency path to identify the upstream root cause rather than clicking the first alerting edge service.
4. **Click Node**:
   Click `payment-service` on the graph before the 30s timer expires.
5. **Approve Recovery** and watch the streak increase on the Scoreboard!

---

### 6.3 Level 3 (Concurrent Chaos Mode — Dual Independent Incidents)

1. **Set Level 3**:
   Click **"L3 · Concurrent Chaos (Dual)"**.
2. **Configure Both Sliders**:
   - Fault A: `2500 ms`
   - Fault B: `12 MB/s`
3. **Trigger Concurrent Chaos**:
   Click the pulsing **"CONCURRENT CHAOS · Fault A + B"** button:
   ```bash
   curl -X POST http://localhost:3000/api/faults/db-latency -H "Content-Type: application/json" -d '{"delay_ms": 2500}'
   curl -X POST http://localhost:3000/api/faults/auth-memory-leak -H "Content-Type: application/json" -d '{"rate_mb_per_sec": 12}'
   ```
4. **Observe Dual Independent Incidents**:
   - Because the correlation engine partitions failure domains (`order_flow` vs `auth`), the system generates **two separate incidents** rather than merging them.
   - An **Active Incidents Switcher** tab strip appears in the Incident Panel:
     `[#inc-1 (order_flow)]  [#inc-2 (auth)]`
5. **Diagnose and Resolve in Any Order**:
   - Select Incident #1: Click `payment-service` in the graph to diagnose, reveal, and approve recovery.
   - Select Incident #2: Click `auth-service` in the graph to diagnose, reveal, and approve recovery.
   - Notice that both can be diagnosed and healed independently without interfering with each other.
6. **Verify Scoreboard**:
   The Scoreboard updates with the total diagnosed count, accuracy percentage, average time to diagnose, and streak!
7. **Clean Up**:
   Click **"Reset All Faults"** to restore all services to normal baseline.

---

## Summary of Completed Verification

| Action | Expected Result | Verified By |
|---|---|---|
| Initial Launch | 5 healthy services, live traces in collector | Aggregated health check |
| Fault A (DB Latency) | `payment-service` ranked #1, naive baseline disagrees | Scoring formula + comparison strip |
| Approval Layer | Action held in `awaiting_approval` until operator clicks Approve | Audit log + API state machine |
| Recovery Execution | Docker restart + health polling | Dockerode + 2s health poll |
| Healing Transition | Node color animates red → green, panel fades | CSS 1.2s transition |
| Fault B (Memory Leak) | `auth-service` ranked #1 with memory RSS evidence | Isolated path attribution |
| Load Creation | `Spawn Order` calls `POST /api/orders` on demand | Visible session counter |
| Sliders | Dynamic fault intensity (500–5000ms, 2–20MB/s) | Custom request payload |
| Diagnose State | Hidden root cause and AI reasoning during `awaiting_diagnosis` | API response redaction + countdown timer |
| Node-Click Guess | Clicking D3 graph node submits diagnosis and unlocks reveal | `POST /api/incidents/:id/diagnose` |
| Difficulty Levels | L1 (60s), L2 (30s ambiguous downstream), L3 (dual chaos) | Threshold overrides + untimed challenge |
| Concurrent Chaos | Two independent simultaneous incidents | Failure domain partitioning (`auth` vs `order_flow`) |
| Persistent Scoreboard | Accuracy %, avg diagnose time, avg recovery time, streak | `GET /api/scoreboard` + `Scoreboard.jsx` |
