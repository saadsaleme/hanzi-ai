const crypto = require("crypto");

const audioCache = globalThis.__hanziTtsCache || new Map();
globalThis.__hanziTtsCache = audioCache;

const VOICES = {
  nova: "nova",
  shimmer: "shimmer",
  echo: "echo",
  onyx: "onyx",
  alloy: "alloy",
  male: "echo",
  female: "nova",
  teacher: "shimmer",
  roleplay: "shimmer",
  femaleteacher: "shimmer",
  maleteacher: "echo",
  youngfemale: "nova",
  professionalmale: "onyx",
  hsklistening: "alloy",
  calmfemale: "shimmer",
  friendlymale: "echo",
  casualMale: "echo",
  casualmale: "echo",
  politevoice: "nova",
  professionalvoice: "onyx",
};

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return sendJson(res, 500, { error: "OpenAI TTS is not configured." });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const text = String(body.text || "").trim().slice(0, 4000);
    const speed = Math.min(1.5, Math.max(0.5, Number(body.speed || 1)));
    const voiceKey = String(body.voice || "nova").replace(/[\s_-]/g, "").toLowerCase();
    const voice = VOICES[voiceKey] || "nova";

    if (!text) return sendJson(res, 400, { error: "Text is required." });

    const cacheKey = crypto.createHash("sha256").update(JSON.stringify({ text, voice, speed })).digest("hex");
    console.log("[HanZi TTS backend] received voice", body.voice, "using", voice, "TTS provider", "openai", "cacheKey", cacheKey);
    const cached = audioCache.get(cacheKey);
    if (cached) {
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("X-HanZi-TTS-Cache", "HIT");
      return res.end(cached);
    }

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
        voice,
        input: text,
        response_format: "mp3",
        speed,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return sendJson(res, response.status, { error: "OpenAI TTS request failed.", detail: errorText.slice(0, 500) });
    }

    const audio = Buffer.from(await response.arrayBuffer());
    audioCache.set(cacheKey, audio);
    if (audioCache.size > 200) audioCache.delete(audioCache.keys().next().value);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-HanZi-TTS-Cache", "MISS");
    return res.end(audio);
  } catch (error) {
    return sendJson(res, 500, { error: "TTS server error.", detail: error.message });
  }
};
