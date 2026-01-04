/**
 * PURE Chart Service (Railway/Render-ready)
 * - Uses built-in fetch (Node 18+)
 * - Accepts minimal birth data and auto-fills timezone for NL
 * - Proxies AstrologyAPI Western Chart endpoint
 */

const express = require("express");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;

// ==== REQUIRED ENV VARS ====
// Set these in Railway/Render environment variables (NOT in code)
const ASTROLOGY_API_USER_ID = process.env.ASTROLOGY_API_USER_ID;
const ASTROLOGY_API_KEY = process.env.ASTROLOGY_API_KEY;

// AstrologyAPI base (most common)
const ASTROLOGY_API_BASE = "https://json.astrologyapi.com/v1";

// Helpers
function requireEnv() {
  if (!ASTROLOGY_API_USER_ID || !ASTROLOGY_API_KEY) {
    return "Missing ASTROLOGY_API_USER_ID or ASTROLOGY_API_KEY in environment variables.";
  }
  return null;
}

function basicAuthHeader(userId, apiKey) {
  const token = Buffer.from(`${userId}:${apiKey}`).toString("base64");
  return `Basic ${token}`;
}

function normalizeTimezone({ timezone, location, country }) {
  // If user already provides timezone → use it
  if (timezone && String(timezone).trim()) return String(timezone).trim();

  const loc = (location || "").toLowerCase();
  const c = (country || "").toLowerCase();

  // Default for NL / Netherlands
  const looksNL =
    c === "nl" ||
    c.includes("netherlands") ||
    c.includes("nederland") ||
    loc.includes("nederland") ||
    loc.includes("netherlands") ||
    loc.includes(", nl") ||
    loc.endsWith(" nl");

  if (looksNL) return "Europe/Amsterdam";

  // Otherwise: leave undefined (API might still accept, but we don't guess other countries)
  return undefined;
}

function validateBirth({ date, time, location }) {
  if (!date || !time || !location) {
    return "Missing required fields: date, time, location";
  }
  // Basic format sanity checks (not strict)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Invalid date format. Use YYYY-MM-DD.";
  if (!/^\d{2}:\d{2}$/.test(time)) return "Invalid time format. Use HH:MM.";
  return null;
}

// Routes
app.get("/", (req, res) => res.status(200).send("OK"));

app.get("/ping", (req, res) => {
  res.status(200).send("OK");
});

app.post("/api/chart/western", async (req, res) => {
  try {
    const envErr = requireEnv();
    if (envErr) return res.status(500).json({ ok: false, error: envErr });

    const { name, date, time, location, country, timezone } = req.body || {};

    const valErr = validateBirth({ date, time, location });
    if (valErr) return res.status(400).json({ ok: false, error: valErr });

    const tz = normalizeTimezone({ timezone, location, country });

    // AstrologyAPI expects these common fields:
    // day, month, year, hour, min, lat, lon, tzone
    // But we do NOT have lat/lon here. Many people use the "place -> lat/lon" flow.
    // So we call the endpoint that accepts "place" if available, otherwise we return a clear error.
    //
    // IMPORTANT:
    // Some AstrologyAPI plans/endpoints support "place" directly, others require lat/lon.
    // We'll implement a robust approach:
    // 1) Try a "place based" request (if supported)
    // 2) If API responds with lat/lon required → return that message clearly

    const [year, month, day] = date.split("-").map((x) => parseInt(x, 10));
    const [hour, min] = time.split(":").map((x) => parseInt(x, 10));

    const payloadPlace = {
      name: name || "",
      day,
      month,
      year,
      hour,
      min,
      place: String(location).trim(), // keep it simple: "Hoorn" / "Hoorn, NL"
      tzone: tz || undefined,
    };

    // Remove undefined keys
    Object.keys(payloadPlace).forEach((k) => payloadPlace[k] === undefined && delete payloadPlace[k]);

    const auth = basicAuthHeader(ASTROLOGY_API_USER_ID, ASTROLOGY_API_KEY);

    // This endpoint name can differ; "western_horoscope" isn't it.
    // The commonly used endpoint for birth chart is "western_chart_data" or "birth_details" depending on account.
    // We'll use western_chart_data first; if your account uses a different endpoint, we switch once.
    const endpoint = `${ASTROLOGY_API_BASE}/western_chart_data`;

    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
      },
      body: JSON.stringify(payloadPlace),
    });

    const text = await r.text();

    // Try parse JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!r.ok) {
      // Give a very clear error back to ChatGPT (so it doesn't keep asking the user)
      return res.status(r.status).json({
        ok: false,
        status: r.status,
        error: "AstrologyAPI request failed",
        details: data,
        hint:
          "Als je AstrologyAPI-account lat/lon vereist, voeg latitude + longitude toe in je requestBody of voeg een geocode stap toe in de server.",
      });
    }

    return res.status(200).json({
      ok: true,
      input: { name: name || "", date, time, location, timezone: tz || null },
      chart: data,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Internal server error",
      details: String(e?.message || e),
    });
  }
});

app.listen(PORT, () => {
  console.log(`PURE Chart Service draait op poort ${PORT}`);
});
