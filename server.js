// server.js (Railway + Express + Axios, CommonJS)

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;

// Railway Variables (zet deze in Railway -> Variables)
const ASTROLOGY_API_USER_ID = process.env.ASTROLOGY_API_USER_ID; // bijv. 648970
const ASTROLOGY_API_KEY = process.env.ASTROLOGY_API_KEY;         // jouw key
const ASTROLOGY_API_BASE =
  process.env.ASTROLOGY_API_BASE || "https://json.astrologyapi.com/v1";

// Helpers
function isValidDateISO(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function isValidTimeHHMM(s) {
  return typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
}
function requireEnv(name, value) {
  if (!value) {
    const err = new Error(`${name} ontbreekt. Zet deze in Railway Variables.`);
    err.statusCode = 500;
    throw err;
  }
}

// Berekent timezone offset (tzone) correct voor NL incl zomertijd
function getTzOffsetHours(dateISO, timeHHMM, timeZone) {
  const [y, m, d] = dateISO.split("-").map((n) => parseInt(n, 10));
  const [hh, mm] = timeHHMM.split(":").map((n) => parseInt(n, 10));

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

  const localAsUTC = Date.UTC(
    parseInt(map.year, 10),
    parseInt(map.month, 10) - 1,
    parseInt(map.day, 10),
    parseInt(map.hour, 10),
    parseInt(map.minute, 10),
    parseInt(map.second, 10)
  );

  const offsetMinutes = (localAsUTC - utcGuess.getTime()) / 60000;
  const offsetHours = Math.round((offsetMinutes / 60) * 100) / 100;
  return offsetHours;
}

// Ping (voor connector test)
app.get("/ping", (req, res) => {
  res.status(200).json({ ok: true, message: "OK" });
});

// Western chart route
app.post("/api/chart/western", async (req, res) => {
  try {
    requireEnv("ASTROLOGY_API_USER_ID", ASTROLOGY_API_USER_ID);
    requireEnv("ASTROLOGY_API_KEY", ASTROLOGY_API_KEY);

    const {
      name = "",
      date,
      time,
      latitude,
      longitude,
      timezone = "Europe/Amsterdam", // default NL
      tz_offset, // optioneel: als je dit zelf wil meegeven
    } = req.body || {};

    // Validatie
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
          "Latitude en longitude zijn verplicht (nummer). Voorbeeld Hoorn: 52.6424, 5.0597",
      });
    }

    const [year, month, day] = date.split("-").map((n) => parseInt(n, 10));
    const [hour, min] = time.split(":").map((n) => parseInt(n, 10));

    const tzone =
      typeof tz_offset === "number"
        ? tz_offset
        : getTzOffsetHours(date, time, timezone);

    // AstrologyAPI payload (belangrijk: lat/lon + tzone)
    const payload = {
      day,
      month,
      year,
      hour,
      min,
      lat: latitude,
      lon: longitude,
      tzone,
    };

    // Endpoint dat jij wilt gebruiken (staat bij jou in de API lijst)
    const endpointPath = "natal_wheel_chart";
    const endpoint = `${ASTROLOGY_API_BASE.replace(/\/$/, "")}/${endpointPath}`;

    // ✅ STAP 1 (debug logging) - hier staat het precies
    console.log("🔮 AstrologyAPI endpoint:", endpoint);
    console.log("📦 AstrologyAPI payload:", payload);
    console.log("🔐 Using User ID:", ASTROLOGY_API_USER_ID);

    // Call AstrologyAPI
    const response = await axios.post(endpoint, payload, {
      auth: {
        username: ASTROLOGY_API_USER_ID,
        password: ASTROLOGY_API_KEY,
      },
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 30000,
      validateStatus: () => true, // we handelen fouten zelf af
    });

    // Als AstrologyAPI geen 200-299 geeft
    if (response.status < 200 || response.status >= 300) {
      console.log("❌ AstrologyAPI status:", response.status);
      console.log("❌ AstrologyAPI response:", response.data);

      return res.status(502).json({
        success: false,
        error: "AstrologyAPI request failed",
        details: {
          status: response.status,
          response: response.data,
        },
        hint:
          "Controleer je plan/endpoint toegang in AstrologyAPI dashboard. Als je account lat/lon vereist: die zitten nu in je request. Als je nog steeds 'not authorized' ziet: het is plan-autorisation.",
      });
    }

    // Soms geeft AstrologyAPI status=false binnen 200
    if (response.data && response.data.status === false) {
      console.log("❌ AstrologyAPI returned status=false:", response.data);

      return res.status(502).json({
        success: false,
        error: "AstrologyAPI rejected the request",
        details: response.data,
      });
    }

    // OK
    return res.status(200).json({
      success: true,
      chart: response.data,
      meta: { name, date, time, latitude, longitude, timezone, tzone },
    });
  } catch (e) {
    console.log("🔥 Server error:", e);

    return res.status(500).json({
      success: false,
      error: e.message || "Onbekende serverfout",
    });
  }
});

app.listen(PORT, () => {
  console.log(`PURE Chart Service draait op poort ${PORT}`);
});
