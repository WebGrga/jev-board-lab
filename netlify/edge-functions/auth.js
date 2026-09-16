const COOKIE_NAME = "jev_session";
const SESSION_SECONDS = 24 * 60 * 60;
const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(password, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return { key, signature: await crypto.subtle.sign("HMAC", key, encoder.encode(value)) };
}

async function passwordsMatch(candidate, configured) {
  const [candidateHash, configuredHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(configured)),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(configuredHash);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

async function createSession(password) {
  const expiresAt = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  const { signature } = await hmac(password, expiresAt);
  return `${expiresAt}.${base64Url(signature)}`;
}

async function validSession(request, password) {
  const cookie = request.headers.get("cookie") || "";
  const encoded = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!encoded) return false;
  const [expiresAt, signature, ...extra] = encoded.split(".");
  if (extra.length || !expiresAt || !signature || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
  try {
    const { key } = await hmac(password, expiresAt);
    return crypto.subtle.verify("HMAC", key, fromBase64Url(signature), encoder.encode(expiresAt));
  } catch {
    return false;
  }
}

function page({ error = "", configured = true } = {}) {
  const message = configured
    ? "Enter the private workspace password to continue."
    : "This private workspace is locked until its password is configured by the owner.";
  const status = error ? `<p class="error" role="alert">${error}</p>` : "";
  const form = configured ? `
    <form method="post" action="./__jev-auth/login">
      <label for="password">Workspace password</label>
      <div class="field-row">
        <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
        <button type="submit">Unlock</button>
      </div>
      ${status}
    </form>` : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jev Board | Private workspace</title>
<style>
  :root{color-scheme:dark;--ink:#f5f3ec;--muted:#a6a39b;--line:#31312e;--accent:#d8ff5f;--danger:#ff8f7c}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0f0d;color:var(--ink);font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}
  body:before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at 78% 14%,rgba(216,255,95,.11),transparent 28%),linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:auto,48px 48px,48px 48px}
  main{position:relative;width:min(92vw,520px);padding:38px;border:1px solid var(--line);border-radius:18px;background:rgba(20,21,18,.94);box-shadow:0 30px 100px rgba(0,0,0,.44)}
  .eyebrow{margin:0 0 22px;color:var(--accent);font:700 12px/1 ui-monospace,SFMono-Regular,monospace;letter-spacing:.14em;text-transform:uppercase}
  h1{margin:0;font-size:clamp(31px,7vw,52px);line-height:.98;letter-spacing:-.055em}p{margin:18px 0 28px;color:var(--muted);max-width:42ch}
  label{display:block;margin-bottom:9px;color:var(--ink);font-weight:650}.field-row{display:grid;grid-template-columns:1fr auto;gap:10px}
  input,button{min-height:48px;border-radius:9px;font:inherit}input{width:100%;border:1px solid #45463f;background:#11120f;color:var(--ink);padding:0 14px;outline:none}input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(216,255,95,.12)}
  button{border:0;background:var(--accent);color:#171a0d;padding:0 22px;font-weight:800;cursor:pointer}button:hover{filter:brightness(1.06)}.error{margin:13px 0 0;color:var(--danger)}
  .lock{display:inline-grid;place-items:center;width:34px;height:34px;margin-bottom:26px;border:1px solid #44463d;border-radius:50%;color:var(--accent)}
  @media(max-width:520px){main{padding:28px}.field-row{grid-template-columns:1fr}button{width:100%}}
</style></head><body><main><div class="lock" aria-hidden="true">●</div><p class="eyebrow">RG Lab / Private</p><h1>Jev Board</h1><p>${message}</p>${form}</main></body></html>`;
}

function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store, private",
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      ...headers,
    },
  });
}

export default async (request, context) => {
  const password = Netlify.env.get("PROTECTED_PAGE_PASSWORD");
  const url = new URL(request.url);
  if (!password) return html(page({ configured: false }), 503);

  if (url.pathname === "/__jev-auth/logout") {
    return new Response(null, {
      status: 303,
      headers: {
        location: "../",
        "set-cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
      },
    });
  }

  if (url.pathname === "/__jev-auth/login" && request.method === "POST") {
    const data = await request.formData();
    const candidate = String(data.get("password") || "");
    if (!(await passwordsMatch(candidate, password))) return html(page({ error: "That password is not correct." }), 401);
    const session = await createSession(password);
    return new Response(null, {
      status: 303,
      headers: {
        location: "../",
        "set-cookie": `${COOKIE_NAME}=${session}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
      },
    });
  }

  if (await validSession(request, password)) return context.next();
  return html(page(), 401);
};
