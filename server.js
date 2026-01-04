// server.js
// PURE Chart Service - Railway friendly
// Endpoints:
//   GET  /ping
//   POST /api/chart/western
//
// Required env vars (Railway Variables):
//   ASTROLOGY_API_USER_ID
//   ASTROLOGY_API_KEY
//
// Optional:
//   ASTROLOGY_API_BASE (default: https://json.astrologyapi.com/v1)

import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;

const ASTROLOGY_API_USER_ID = process.env.ASTROLOGY_API_USER_ID;
const ASTROLOGY_API_KEY = process.env.ASTROLOGY_API_KEY;
const ASTROLOGY_API_BASE =
  process.env.ASTROLOGY_API_BASE || "https://json.astrologyapi.com/v1";

// -------------------- Helpers --------------------

function requireEnv(name, value) {
  if (!value) {
    const err = new Error(`${name} ontbreekt. Zet deze in Railway Variables.`);
    err.statusCode = 500;
    throw err;
  }
}

/**
 * Compute timezone offset in hours for a given local datetime in a given IANA timezone.
 * Returns a number like 1 or 2 (can be decimals for other zones).
 *
 * Works without extra dependencies (Luxon/Moment not needed).
 */
function getTzOffsetHours(dateISO, timeHHMM, timeZone) {
  // dateISO: "1981-10-17"
  // timeHHMM: "08:55"
  const [y, m, d] = dateISO.split("-").map((n) => parseInt(n, 10));
  const [hh, mm] = timeHHMM.split(":").map((n) => parseInt(n, 10));

  // Start with a UTC date constructed from the provided wall time.
  // We'll compare what that "instant" looks like in the requested time zone to infer offset.
  const utcGuess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));

  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = dtf.formatToParts(utcGuess);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  // This is the "local time" in the target time zone for the utcGuess instant.
  const localAsUTC = Date.UTC(
    parseInt(map.year, 10),
    parseInt(map.month, 10) - 1,
    parseInt(map.day, 10),
    parseInt(map.hour, 10),
    parseInt(map.minute, 10),
    parseInt(map.second, 10)
  );

  // Offset = localTime - utcTime (in minutes/hours)
  const offsetMinutes = (localAsUTC - utcGuess.getTime()) / 60000;
  const offsetHours = offsetMinutes / 60;

  // Round to 2 decimals (safe for most APIs)
  return Math.round(offsetHours * 100) / 100;
}

function isValidDateISO(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isValidTimeHHMM(s) {
  return typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
}

async function callAstrologyApi(endpoint, payload) {
  requireEnv("ASTROLOGY_API_USER_ID", ASTROLOGY_API_USER_ID);
  requireEnv("ASTROLOGY_API_KEY", ASTROLOGY_API_KEY);

  const url = `${ASTROLOGY_API_BASE.replace(/\/$/, "")}/${endpoint.replace(
    /^\//,
    ""
  )}`;

  const auth = Buffer.from(
    `${ASTROLOGY_API_USER_ID}:${ASTROLOGY_API_KEY}`
  ).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error("AstrologyAPI request failed");
    err.statusCode = 502;
    err.details = { status: res.status, response: data };
    throw err;
  }

  // AstrologyAPI sometimes returns { status: false, msg: "..." }
  if (data && (data.status === false || data.status === "false")) {
    const err = new Error("AstrologyAPI rejected the request");
    err.statusCode = 502;
    err.details = data;
    throw err;
  }

  return data;
}

// -------------------- Routes --------------------

app.get("/ping", (req, res) => {
  res.status(200).json({ ok: true, message: "OK" });
});

app.post("/api/chart/western", async (req, res) => {
  try {
    const {
      name = "",
      date,
      time,
      latitude,
      longitude,
      timezone = "Europe/Amsterdam",
      tz_offset, // optional override if user provides it
    } = req.body || {};

    // Basic validation
    if (!isValidDateISO(date)) {
      return res.status(400).json({
        success: false,
        error: "Ongeldige datum. Gebruik 'YYYY-MM-DD' (bijv. 1981-10-17).",
      });
    }
    if (!isValidTimeHHMM(time)) {
      return res.status(400).json({
        success: false,
        error: "Ongeldige tijd. Gebruik 'HH:MM' (bijv. 08:55).",
      });
    }
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return res.status(400).json({
        success: false,
        error:
          "Latitude en longitude zijn verplicht (nummer). Voorbeeld: 52.6424 en 5.0597.",
      });
    }
    if (typeof timezone !== "string" || timezone.length < 3) {
      return res.status(400).json({
        success: false,
        error:
          "Timezone is verplicht. Gebruik bijv. 'Europe/Amsterdam'.",
      });
    }

    // Convert date/time to fields AstrologyAPI expects
    const [year, month, day] = date.split("-").map((n) => parseInt(n, 10));
    const [hour, min] = time.split(":").map((n) => parseInt(n, 10));

    // Determine tz offset hours (Netherlands: usually 1 or 2 depending on DST)
    const tzone =
      typeof tz_offset === "number"
        ? tz_offset
        : getTzOffsetHours(date, time, timezone);

    // Payload for AstrologyAPI "natal_wheel_chart" (Starter plan supports this)
    const payload = {
      day,
      month,
      year,
      hour,
      min,
      lat: latitude,
      lon: longitude,
      tzone, // numeric offset in hours
    };

    const chart = await callAstrologyApi("natal_wheel_chart", payload);

    return res.status(200).json({
      success: true,
      chart,
      meta: {
        name,
        date,
        time,
        latitude,
        longitude,
        timezone,
        tzone,
      },
    });
  } catch (e) {
    const status = e.statusCode || 500;
    res.status(status).json({
      success: false,
      error: e.message || "Onbekende fout",
      details: e.details || null,
    });
  }
});

// -------------------- Start --------------------

app.listen(PORT, () => {
  console.log(`PURE Chart Service draait op poort ${PORT}`);
});
