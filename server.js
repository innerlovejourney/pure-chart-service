import express from "express";


const app = express();

/**
 * Middleware
 */
app.use(express.json());

// Log elke inkomende request (voor debug)
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

/**
 * Root route — verplicht voor Railway health check
 */
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

/**
 * Health check
 */
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/**
 * Ping test (voor ChatGPT Actions)
 */
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, ping: "pong" });
});

/**
 * Western astrology chart endpoint
 */
app.post("/api/chart/western", async (req, res) => {
  try {
    const { name, birth, house_type = "placidus" } = req.body;

    if (!birth) {
      return res.status(400).json({ error: "Birth data ontbreekt" });
    }

    const userId = process.env.ASTROLOGY_API_USER_ID;
    const apiKey = process.env.ASTROLOGY_API_KEY;

    if (!userId || !apiKey) {
      return res.status(500).json({ error: "Astrology API credentials ontbreken" });
    }

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

    if (!response.ok) {
      const text = await response.text();
      console.error("AstrologyAPI error:", text);
      return res.status(502).json({ error: "AstrologyAPI fout", details: text });
    }

    const data = await response.json();

    res.json({
      name: name || null,
      birth,
      source: "astrologyapi.com",
      data,
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Interne serverfout" });
  }
});

/**
 * Start server — Railway compatible
 */
const PORT = Number(process.env.PORT || 8080);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`PURE Chart Service draait op poort ${PORT}`);
});
