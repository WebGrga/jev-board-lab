import assert from "node:assert/strict";

let configuredPassword;
globalThis.Netlify = { env: { get: () => configuredPassword } };

const { default: gate } = await import("../netlify/edge-functions/auth.js");
const { default: worker } = await import("../worker/src/index.js");
const next = () => new Response("private app");

configuredPassword = undefined;
let response = await gate(new Request("https://example.com/"), { next });
assert.equal(response.status, 503);
assert.match(await response.text(), /locked until its password is configured/);

configuredPassword = "correct horse battery staple";
response = await gate(new Request("https://example.com/"), { next });
assert.equal(response.status, 401);
assert.match(await response.text(), /action="\.\/__jev-auth\/login"/);

response = await gate(new Request("https://example.com/__jev-auth/login", {
  method: "POST",
  body: new URLSearchParams({ password: "wrong" }),
}), { next });
assert.equal(response.status, 401);

response = await gate(new Request("https://example.com/__jev-auth/login", {
  method: "POST",
  body: new URLSearchParams({ password: configuredPassword }),
}), { next });
assert.equal(response.status, 303);
assert.equal(response.headers.get("location"), "../");
const cookie = response.headers.get("set-cookie").split(";")[0];
assert.match(response.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Strict/);

response = await gate(new Request("https://example.com/", { headers: { cookie } }), { next });
assert.equal(response.status, 200);
assert.equal(await response.text(), "private app");

const workerRequest = () => new Request("https://worker.example/evaluate", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://lab.rokogrga.com" },
  body: JSON.stringify({ state: { row: 1 }, questions: { q1: { type: "noul", instructions: "Is this valid?" } } }),
});

response = await worker.fetch(workerRequest(), {
  ALLOWED_ORIGINS: "https://lab.rokogrga.com",
  TYPESAFE_API_KEY: "unused-in-this-test",
});
assert.equal(response.status, 503);

response = await worker.fetch(workerRequest(), {
  ALLOWED_ORIGINS: "https://lab.rokogrga.com",
  PROTECTED_PAGE_PASSWORD: configuredPassword,
  TYPESAFE_API_KEY: "unused-in-this-test",
});
assert.equal(response.status, 401);

console.log("Authentication gate tests passed.");
