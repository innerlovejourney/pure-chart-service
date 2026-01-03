import express from "express";

const app = express();

/**
 * Middleware
 */
app.use(express.json());

// Log elke request (handig voor debug)
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

/**
 * Root route (Railway checkt vaak /)
 */
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

/**
 * Health check
 */
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

/**
 * Ping test
 */
app.get("/api/ping", (req, res) => {
  res.status(200).json({ ok: true, ping: "pong" });
});

/**
 * Western astrology chart endpoint
 */
app.post("/api/chart/western", async (req, res) => {
  try {
    const { name, birth, house_type = "placidus" } = req.body;

    if (!birth) {
      return res.status(400).json({ ok: false, error: "Birth data ontbreekt" });
    }

    const userId = process.env.ASTROLOGY_API_USER_ID;
    const apiKey = process.env.ASTROLOGY_API_KEY;

    if (!userId || !apiKey) {
      return res.status(500).json({
        ok: false,
        error: "Astrology API credentials ontbreken (check Railway Variables)",
      });
    }

    // Let op: Node 22 heeft fetch ingebouwd, dus GEEN node-fetch nodig
    const apiUrl = "https://json.astrologyapi.com/v1/western_horoscope";
    const auth = Buffer.from(`${userId}:${apiKey}`).toString("base64");

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        ...birth,
        house_type,
      }),
    });

    const rawText = await response.text();

    if (!response.ok) {
      console.error("AstrologyAPI error:", rawText);
      return res.status(502).json({
        ok: false,
        error: "AstrologyAPI fout",
        details: rawText,
      });
    }

    const data = JSON.parse(rawText);

    return res.status(200).json({
      ok: true,
      name: name || null,
      birth,
      source: "astrologyapi.com",
      data,
    });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ ok: false, error: "Interne serverfout" });
  }
});

/**
 * Start server (Railway)
 */
const PORT = Number(process.env.PORT || 8080);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`PURE Chart Service draait op poort ${PORT}`);
});
