/**
 * ============================================================================
 *  seed.js — Backfill synthetic telemetry for visual testing
 *  ---------------------------------------------------------------------------
 *  Generates realistic PZEM-004T data at 10-second intervals for N days.
 *
 *  Usage:
 *    node seed.js                 # seed 7 days (default), keep existing rows
 *    node seed.js --clear         # wipe this device's rows first, then seed
 *    node seed.js --days=14       # seed 14 days
 *    node seed.js --days=7 --clear
 *
 *  Patterns baked in:
 *    - Diurnal cycle: idle 00:00–06:00, ramp 06:00–08:00,
 *                     morning + evening peaks, wind down after 22:00.
 *    - Weekends have ~30% higher load than weekdays.
 *    - Occasional appliance spikes (microwave / kettle).
 *    - Slight voltage drift (±5 V) + noise.
 *    - Frequency wobbles around 50 Hz (±0.15 Hz).
 *    - Energy is strictly monotonically increasing (as it is in hardware).
 * ============================================================================
 */

require("dotenv").config();
const { Pool } = require("pg");

/* -------------------------- config ---------------------------------------- */
const DEVICE = process.env.SEED_DEVICE || "esp32_pzem_01";
const INTERVAL_SECONDS = 10;
const BATCH_SIZE = 1000; // rows per INSERT — stays well under PG's 65k param cap

const args = process.argv.slice(2);
const CLEAR = args.includes("--clear");
const DAYS = parseInt(
    args.find((a) => a.startsWith("--days="))?.split("=")[1] ?? "7",
    10
);

/* -------------------------- pool ------------------------------------------ */
const pool = new Pool({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || "5432", 10),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

/* -------------------------- load profile ---------------------------------- */
/**
 * Returns the typical current draw (A) for a given hour-of-day (0..24).
 * Shape: flat-low overnight, sharp ramp at 6–8 am, midday plateau,
 * big dinner peak 18–21, wind-down 22–midnight.
 */
function hourlyLoadShape(hour) {
    if (hour < 6) return 0.25;                  // deep night: fridge + router
    if (hour < 8) return 0.25 + (hour - 6) * 1.5;   // morning ramp
    if (hour < 12) return 1.8 + Math.sin((hour - 8) * 0.6) * 0.6; // late morning
    if (hour < 17) return 1.5 + Math.sin((hour - 12) * 0.4) * 0.4; // afternoon
    if (hour < 22) return 2.8 + Math.sin((hour - 17) * 0.5) * 0.8; // dinner peak
    return Math.max(0.3, 3.5 - (hour - 22) * 0.8); // wind down
}

/* -------------------------- generator ------------------------------------- */
function generatePacket(t, energyWh) {
    const date = new Date(t);
    const hour = date.getHours() + date.getMinutes() / 60;
    const weekday = date.getDay();
    const weekendBoost = weekday === 0 || weekday === 6 ? 1.3 : 1.0;

    // --- current (A) ---
    let current = hourlyLoadShape(hour) * weekendBoost;

    // Fridge compressor cycles (~30 min period, adds ~0.8A when on)
    const fridgeOn = Math.sin(t / 1000 / 1800 * Math.PI) > 0.3;
    if (fridgeOn) current += 0.8;

    // Random appliance spike (microwave/kettle) — short burst, 0.2% chance per tick
    if (Math.random() < 0.002 && hour > 6 && hour < 23) {
        current += 4 + Math.random() * 3;
    }

    // Small sensor noise
    current += (Math.random() - 0.5) * 0.15;
    current = Math.max(0, current);

    // --- voltage (V): 230V nominal, slow sinusoidal drift + noise ---
    let voltage =
        230 +
        5 * Math.sin(t / 1000 / 3600 / 2) + // 4-hour drift envelope
        (Math.random() - 0.5) * 3;
    // rare brownout / spike events
    if (Math.random() < 0.0005) voltage -= 12;
    if (Math.random() < 0.0003) voltage += 14;

    // --- power factor ---
    const pf = current > 0.1 ? 0.82 + Math.random() * 0.16 : 0;

    // --- power (W) ---
    const power = voltage * current * pf;

    // --- frequency (Hz) ---
    const frequency =
        50 + Math.sin(t / 1000 / 60) * 0.08 + (Math.random() - 0.5) * 0.1;

    // --- cumulative energy (Wh) ---
    const newEnergyWh = energyWh + (power * INTERVAL_SECONDS) / 3600;

    return {
        voltage: Number(voltage.toFixed(2)),
        current: Number(current.toFixed(3)),
        power: Number(power.toFixed(2)),
        energy: Number(newEnergyWh.toFixed(2)),
        frequency: Number(frequency.toFixed(2)),
        pf: Number(pf.toFixed(2)),
    };
}

/* -------------------------- batch insert ---------------------------------- */
async function insertBatch(rows) {
    const values = [];
    const placeholders = rows
        .map((row, i) => {
            const base = i * 8 + 1;
            values.push(...row);
            return `($${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
        })
        .join(",");

    await pool.query(
        `INSERT INTO pzem_telemetry
           (device_id, voltage_v, current_a, power_w, energy_wh,
            frequency_hz, power_factor, created_at)
         VALUES ${placeholders}`,
        values
    );
}

/* -------------------------- main ------------------------------------------ */
async function main() {
    console.log(`[SEED] Target device: ${DEVICE}`);
    console.log(`[SEED] Days to seed:  ${DAYS}`);

    // Sanity check the connection.
    try {
        await pool.query("SELECT 1");
    } catch (err) {
        console.error("[SEED] Cannot connect to Postgres:", err.message);
        process.exit(1);
    }

    if (CLEAR) {
        console.log(`[SEED] Clearing existing rows for ${DEVICE}…`);
        const { rowCount } = await pool.query(
            "DELETE FROM pzem_telemetry WHERE device_id = $1",
            [DEVICE]
        );
        console.log(`[SEED] Deleted ${rowCount.toLocaleString()} rows.`);
    }

    const endTime = Date.now();
    const startTime = endTime - DAYS * 24 * 60 * 60 * 1000;
    const totalPoints = Math.floor((endTime - startTime) / (INTERVAL_SECONDS * 1000));

    console.log(
        `[SEED] Generating ${totalPoints.toLocaleString()} points ` +
        `(${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()})`
    );

    let energy = 0;
    let inserted = 0;
    let batch = [];
    const started = Date.now();

    for (let t = startTime; t < endTime; t += INTERVAL_SECONDS * 1000) {
        const p = generatePacket(t, energy);
        energy = p.energy;

        batch.push([
            DEVICE,
            p.voltage,
            p.current,
            p.power,
            p.energy,
            p.frequency,
            p.pf,
            new Date(t).toISOString(),
        ]);

        if (batch.length >= BATCH_SIZE) {
            await insertBatch(batch);
            inserted += batch.length;
            batch = [];

            const pct = ((inserted / totalPoints) * 100).toFixed(1);
            process.stdout.write(
                `\r[SEED] Inserted ${inserted.toLocaleString()} / ${totalPoints.toLocaleString()}  (${pct}%)`
            );
        }
    }

    if (batch.length) {
        await insertBatch(batch);
        inserted += batch.length;
    }

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
        `\n[SEED] Done. Inserted ${inserted.toLocaleString()} rows in ${secs}s.`
    );
    console.log(
        `[SEED] Final cumulative energy: ${energy.toFixed(2)} Wh ` +
        `(${(energy / 1000).toFixed(3)} kWh)`
    );

    await pool.end();
}

main().catch((err) => {
    console.error("\n[SEED] FATAL:", err);
    pool.end().catch(() => { });
    process.exit(1);
});
