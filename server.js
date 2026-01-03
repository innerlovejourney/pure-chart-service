import express from "express";
import axios from "axios";
import cors from "cors";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());
// Log elke inkomende request (zodat we zien of ChatGPT je endpoint raakt)
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

const ASTRO_BASE = "https://json.astrologyapi.com/v1";
const USER = process.env.ASTROLOGY_API_USER_ID;
const KEY = process.env.ASTROLOGY_API_KEY;

// ============================
// Simple in-memory cache
// ============================
const cache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dagen

function makeCacheKey(birth, houseType) {
  const { day, month, year, hour, min, lat, lon, tzone } = birth;
  return `${day}-${month}-${year}-${hour}-${min}-${lat}-${lon}-${tzone}-${houseType}`;
}

// ============================
// Normalizers
// ============================
function normalizeBodies(raw) {
  const bodies = [];
  const planetList =
    raw?.planets ||
    raw?.planet_positions ||
    raw?.objects ||
    [];

  const push = (name, obj) => {
    bodies.push({
      name,
      sign: obj.sign || obj.zodiac_sign || obj.sign_name || null,
      house: obj.house || obj.house_number || null,
      degree: obj.degree ?? obj.full_degree ?? obj.longitude ?? null,
      retro: Boolean(obj.is_retro || obj.retrograde || false),
    });
  };

  if (Array.isArray(planetList)) {
    for (const p of planetList) {
      if (!p) continue;
      let name = p.name || p.planet || p.object;
      if (!name) continue;

      const lower = name.toLowerCase();
      if (lower.includes("rahu") || lower.includes("north")) name = "NorthNode";
      if (lower.includes("ketu") || lower.includes("south")) name = "SouthNode";
      if (lower.includes("chiron")) name = "Chiron";
      if (lower.includes("lilith") || lower.includes("black")) name = "Lilith";

      push(name, p);
    }
  }

  const unique = new Map();
  for (const b of bodies) {
    if (!unique.has(b.name)) unique.set(b.name, b);
  }
  return Array.from(unique.values());
}

function normalizeHouses(raw) {
  const list = raw?.houses || [];
  return list.map(h => ({
    house: h.house || h.house_number || null,
    sign: h.sign || h.zodiac_sign || null,
    start_degree: h.start_degree ?? h.start ?? null,
    end_degree: h.end_degree ?? h.end ?? null
  })).filter(h => h.house !== null);
}

// ============================
// Routes
// ============================
app.get("/health", (req, res) => {
  res.json({ ok: true });
});
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, ping: "pong" });
});

app.post("/api/chart/western", async (req, res) => {
  try {
    if (!USER || !KEY) {
      return res.status(500).json({ error: "AstrologyAPI credentials ontbreken" });
    }

    const { name, birth, house_type = "placidus" } = req.body;
    if (!birth) {
      return res.status(400).json({ error: "birth object ontbreekt" });
    }

    const required = ["day","month","year","hour","min","lat","lon","tzone"];
    for (const f of required) {
      if (birth[f] === undefined || birth[f] === null) {
        return res.status(400).json({ error: `birth.${f} ontbreekt` });
      }
    }

    const cacheKey = makeCacheKey(birth, house_type);
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.savedAt) < CACHE_TTL_MS) {
      return res.json({ ...cached.data, cached: true });
    }

    const payload = new URLSearchParams({
      day: birth.day,
      month: birth.month,
      year: birth.year,
      hour: birth.hour,
      min: birth.min,
      lat: birth.lat,
      lon: birth.lon,
      tzone: birth.tzone,
      house_type
    });

    const response = await axios.post(
      `${ASTRO_BASE}/western_chart_data`,
      payload,
      {
        auth: { username: USER, password: KEY },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15000
      }
    );

    const raw = response.data;

    const clean = {
      name: name || null,
      birth: { ...birth, house_type },
      bodies: normalizeBodies(raw),
      houses: normalizeHouses(raw),
      aspects: raw?.aspects || [],
      source: "western_chart_data"
    };

    cache.set(cacheKey, { savedAt: Date.now(), data: clean });

    res.json({ ...clean, cached: false });

  } catch (err) {
    res.status(502).json({
      error: "Chart ophalen mislukt",
      details: err?.response?.data || err.message
    });
  }
});

// ============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PURE Chart Service draait op poort ${PORT}`);
});
