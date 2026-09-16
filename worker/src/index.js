const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MAX_BODY_BYTES = 160_000;
const MAX_STATE_CHARS = 120_000;
const MAX_QUESTIONS = 20;

function allowedOrigin(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : allowed[0] || "";
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "vary": "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

function validateQuestions(questions) {
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) return "questions must be an object";
  const entries = Object.entries(questions);
  if (!entries.length || entries.length > MAX_QUESTIONS) return `questions must contain 1-${MAX_QUESTIONS} items`;
  for (const [id, question] of entries) {
    if (!/^[a-z0-9_]{1,48}$/.test(id)) return `invalid question id: ${id}`;
    if (!question || !["noul", "choice", "score"].includes(question.type)) return `invalid type for ${id}`;
    if (typeof question.instructions !== "string" || !question.instructions.trim()) return `instructions are required for ${id}`;
    if (question.type === "choice" && (!question.criteria || Object.keys(question.criteria).length < 2)) return `choice ${id} needs at least two options`;
    if (question.type === "score" && (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10)) return `score ${id} needs 2-10 levels`;
  }
  return "";
}

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get("origin") || "";
    const origin = allowedOrigin(requestOrigin, env);
    if (!origin || (requestOrigin && origin !== requestOrigin)) return json({ error: "Origin not allowed" }, 403, origin || "null");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/evaluate") return json({ error: "Not found" }, 404, origin);
    if (!env.TYPESAFE_API_KEY) return json({ error: "Jev API is not configured" }, 503, origin);
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) return json({ error: "Request is too large" }, 413, origin);

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "Request is too large" }, 413, origin);
    let payload;
    try { payload = JSON.parse(raw); } catch { return json({ error: "Invalid JSON body" }, 400, origin); }
    if (payload.state === undefined || payload.state === null) return json({ error: "state is required" }, 400, origin);
    if (JSON.stringify(payload.state).length > MAX_STATE_CHARS) return json({ error: "State is too large for one Jev request" }, 413, origin);
    const questionError = validateQuestions(payload.questions);
    if (questionError) return json({ error: questionError }, 400, origin);

    const upstream = await fetch(TYPESAFE_ENDPOINT, {
      method: "POST",
      headers: { "authorization": `Bearer ${env.TYPESAFE_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ state: payload.state, model: "jev-latest", questions: payload.questions }),
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...corsHeaders(origin), "content-type": upstream.headers.get("content-type") || "application/json" },
    });
  },
};
