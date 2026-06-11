function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function normalizeHistory(history = []) {
  return history
    .filter((item) => item && ["user", "assistant", "system"].includes(item.role) && item.content)
    .slice(-20)
    .map((item) => ({ role: item.role, content: String(item.content).slice(0, 4000) }));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return sendJson(res, 500, { error: "OpenAI Tutor is not configured." });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const message = String(body.message || "").trim().slice(0, 4000);
    if (!message) return sendJson(res, 400, { error: "Message is required." });

    const system = String(body.system || "You are HanZi Tutor, a helpful Chinese teacher.").slice(0, 4000);
    const verifiedContext = JSON.stringify(body.verifiedHskContext || {}).slice(0, 8000);
    const activeState = JSON.stringify(body.activeLearningState || {}).slice(0, 5000);
    const language = String(body.language || "English").slice(0, 80);

    const messages = [
      { role: "system", content: `${system}\n\nUser interface language: ${language}\n\nUse this verified local HSK context first:\n${verifiedContext}\n\nCurrent learning state:\n${activeState}` },
      ...normalizeHistory(body.conversationHistory),
      { role: "user", content: message },
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TUTOR_MODEL || "gpt-4o-mini",
        messages,
        temperature: 0.35,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return sendJson(res, response.status, { error: "OpenAI Tutor request failed.", detail: errorText.slice(0, 500) });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "";
    return sendJson(res, 200, { reply });
  } catch (error) {
    return sendJson(res, 500, { error: "Tutor server error.", detail: error.message });
  }
};
