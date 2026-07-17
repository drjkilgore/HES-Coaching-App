// netlify/functions/ai.js
// Serverless proxy so the browser never sees your Anthropic key.
// Set ANTHROPIC_API_KEY in Netlify → Site settings → Environment variables.
// The app calls POST /.netlify/functions/ai and expects { text }.

const MODEL = "claude-sonnet-4-6"; // adjust as needed

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }) };

  let payload = {};
  try { payload = JSON.parse(event.body || "{}"); } catch { /* ignore */ }

  const prompt = buildPrompt(payload);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system:
          "You are a veteran instructional coach writing concise, professional, evidence-based coaching notes " +
          "for a school leader. Warm but specific. No filler, no AI throat-clearing. Use short bullet points.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await r.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return { statusCode: 200, headers: cors, body: JSON.stringify({ text }) };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(e) }) };
  }
};

function buildPrompt(p) {
  if (p.task === "observation_recs") {
    const gaps = (p.flags || []).filter(([, v]) => v !== "Yes").map(([k]) => k).join(", ") || "none";
    return (
      `Write 3–4 next-step coaching recommendations for teacher ${p.teacher || ""}.\n` +
      `Lesson objective: ${p.objective || "(not stated)"}\n` +
      `Evidence observed: ${p.evidence || "(none)"}\n` +
      `Checklist areas not fully observed: ${gaps}.\n` +
      `Return only the bullet points.`
    );
  }
  if (p.task === "eoy_narrative") {
    return (
      `Compile an end-of-year instructional coaching summary for ${p.teacher}. ` +
      `Goals: ${(p.goals || []).join("; ")}. Outcomes: ${(p.outcomes || []).join("; ")}. ` +
      `Write 2 short paragraphs in the voice of a professional instructional consultant.`
    );
  }
  return p.prompt || "Write a brief professional coaching note.";
}
