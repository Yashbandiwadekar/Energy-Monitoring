-- ============================================================================
-- PZEM-004T Energy Telemetry — PostgreSQL Time-Series Schema
-- ============================================================================
-- Optimised for an append-only ingest pattern (~1 row per device every 10 s)
-- with frequent "latest N rows" reads from the dashboard.
--
-- Design notes:
--   * BIGSERIAL id  → 8 bytes, future-proof for billions of rows.
--   * TIMESTAMPTZ   → always store with timezone; avoids DST/locale bugs.
--   * REAL (float4) → 4 bytes, ~7 digits precision, ample for V/I/P/PF/Hz.
--   * DOUBLE        → used for cumulative energy (precision matters over time).
--   * BRIN index    → ideal for time-ordered inserts: tiny on disk, fast range
--                     scans. Typical size ~0.1% of a B-tree on same column.
--   * (device_id, created_at DESC) B-tree → makes "last N for device X"
--                     queries use an index-only scan, no sort.
-- ============================================================================

CREATE TABLE IF NOT EXISTS pzem_telemetry (
    id            BIGSERIAL        PRIMARY KEY,
    device_id     VARCHAR(64)      NOT NULL,
    voltage_v     REAL             NOT NULL,
    current_a    REAL              NOT NULL,
    power_w       REAL             NOT NULL,
    energy_wh     DOUBLE PRECISION NOT NULL,
    frequency_hz  REAL             NOT NULL,
    power_factor  REAL             NOT NULL,
    created_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- Block Range INdex on created_at — perfect for append-only time-series.
-- Uses ~1000x less disk space than an equivalent B-tree and is excellent
-- for range queries like "give me the last 5 minutes".
CREATE INDEX IF NOT EXISTS idx_pzem_created_at_brin
    ON pzem_telemetry
    USING BRIN (created_at)
    WITH (pages_per_range = 32);

-- Composite B-tree to accelerate the dashboard's most common query:
-- "last N records for a specific device, newest first".
CREATE INDEX IF NOT EXISTS idx_pzem_device_created
    ON pzem_telemetry (device_id, created_at DESC);

-- Optional hardening: prevent obviously-bad packets from being persisted.
-- Comment out if you prefer to accept any value and filter at query time.
ALTER TABLE pzem_telemetry
    ADD CONSTRAINT chk_pzem_sane_ranges
    CHECK (
        voltage_v    BETWEEN 0    AND 500
        AND current_a    BETWEEN 0    AND 200
        AND power_w      BETWEEN -50  AND 50000
        AND energy_wh    >= 0
        AND frequency_hz BETWEEN 0    AND 100
        AND power_factor BETWEEN -1   AND 1
    );

-- ============================================================================
-- Future scaling note:
-- When row count gets into the tens of millions, consider native declarative
-- partitioning by month:
--   CREATE TABLE pzem_telemetry (...) PARTITION BY RANGE (created_at);
-- Or install the TimescaleDB extension and convert this to a hypertable:
--   SELECT create_hypertable('pzem_telemetry', 'created_at');
-- For a hobby/lab project running a single ESP32, neither is needed yet.
-- ============================================================================
