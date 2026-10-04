import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const upstream = "https://api.unorouter.com/v1/chat/completions";

const defaultModels = [
  "k2-horizon:free",
  "space-bunny-alpha:free",
  "intern-s2:free",
  "qwen3.8-flash-next:free",
  "atria-dawn-preview:free",
  "glm-5.3-flash:free"
];

const models = (process.env.FREE_MODELS || defaultModels.join(","))
  .split(",")
  .map(model => model.trim())
  .filter(Boolean);

let nextModelIndex = 0;

app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));


if (!process.env.UNOROUTER_API_KEY || process.env.UNOROUTER_API_KEY === "your_api_key_here" || process.env.UNOROUTER_API_KEY === "put_your_real_unorouter_api_key_here") {
  console.error("Set UNOROUTER_API_KEY in .env before starting CMPLX-AI.");
  process.exit(1);
}

if (!models.length) {
  console.error("No free models are configured.");
  process.exit(1);
}

app.get("/api/config", (_req, res) => {
  res.json({
    name: "CMPLX-AI",
    freePoolSize: models.length
  });
});

function modelOrder() {
  const ordered = [];

  for (let offset = 0; offset < models.length; offset++) {
    ordered.push(models[(nextModelIndex + offset) % models.length]);
  }

  nextModelIndex = (nextModelIndex + 1) % models.length;
  return ordered;
}

async function requestModel(model, messages, temperature, maxTokens) {
  return fetch(upstream, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UNOROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: Math.max(0, Math.min(2, Number(temperature))),
      max_tokens: Math.max(1, Math.min(16384, Number(maxTokens)))
    })
  });
}

app.post("/api/chat", async (req, res) => {
  try {
    const { messages, temperature = 0.7, max_tokens = 4096, profile = "" } = req.body;

    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: "No messages supplied." });
    }

    const cleanMessages = messages
      .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
      .map(m => ({
        role: m.role,
        content: m.content.slice(0, 120000)
      }));

    if (!cleanMessages.length) {
      return res.status(400).json({ error: "No valid messages supplied." });
    }

    const systemPrompt = process.env.SYSTEM_PROMPT?.trim();
    const profileMessage = typeof profile === "string" ? profile.trim().slice(0, 500) : "";
    const finalMessages = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...(profileMessage ? [{ role: "system", content: profileMessage }] : []), ...cleanMessages]
      : (profileMessage ? [{ role: "system", content: profileMessage }, ...cleanMessages] : cleanMessages);

    let response;
    let lastError = "All configured free models are currently unavailable.";

    for (const model of modelOrder()) {
      const attempt = await requestModel(model, finalMessages, temperature, max_tokens);

      if (attempt.ok) {
        response = attempt;
        break;
      }

      const detail = await attempt.text();
      lastError = detail || `HTTP ${attempt.status}`;

      if (![408, 409, 429, 500, 502, 503, 504].includes(attempt.status)) {
        return res.status(attempt.status).json({
          error: "The AI request failed.",
          detail: lastError.slice(0, 2000)
        });
      }
    }

    if (!response) {
      return res.status(429).json({
        error: "All free models are currently rate limited or unavailable.",
        detail: "Try again shortly."
      });
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    if (!response.body) {
      res.write(`data: ${JSON.stringify({ error: "The upstream response had no body." })}\n\n`);
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Server error." });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message || "Server error." })}\n\n`);
      res.end();
    }
  }
});

app.listen(port, () => {
  console.log(`CMPLX-AI running at http://localhost:${port}`);
  console.log(`Free model pool: ${models.length} models`);
});
