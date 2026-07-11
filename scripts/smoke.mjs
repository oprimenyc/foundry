#!/usr/bin/env node
// Smoke test for Foundry. Run against a live server:
//   BASE_URL=http://localhost:3000 node scripts/smoke.mjs
// Exits non-zero on any failure.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const TOKEN = process.env.FOUNDRY_API_TOKEN || "";
const AUTH = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL: ${name} — ${err.message}`);
  }
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

await check("GET /api/healthz returns ok + config report", async () => {
  const res = await fetch(`${BASE}/api/healthz`);
  expect(res.ok, `status ${res.status}`);
  const body = await res.json();
  expect(body.status === "ok", "status not ok");
  expect(body.service === "foundry", "wrong service name");
  expect(["configured", "missing_api_key"].includes(body.planner), "planner field missing");
});

await check("GET / redirects to /projects/new", async () => {
  const res = await fetch(`${BASE}/`);
  expect(res.ok, `status ${res.status}`);
  expect(res.url.includes("/projects/new"), `expected to land on /projects/new, got ${res.url}`);
});

await check("GET /projects/new serves the planner UI", async () => {
  const res = await fetch(`${BASE}/projects/new`);
  expect(res.ok, `status ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  expect(ct.includes("text/html"), `expected HTML, got ${ct}`);
});

await check("unauthenticated POST /api/plan is rejected when auth is enforced", async () => {
  const res = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Deploy a Next.js site to Vercel." }),
  });
  if (TOKEN) {
    expect(res.status === 401, `expected 401, got ${res.status}`);
  } else {
    expect(res.status !== 401, `unexpected 401 with no token configured`);
  }
});

await check("POST /api/plan rejects bad body with 400", async () => {
  const res = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH },
    body: JSON.stringify({ prompt: "short" }),
  });
  expect(res.status === 400, `expected 400, got ${res.status}`);
});

await check("POST /api/plan without API key returns 503 JSON (or 200 if key set)", async () => {
  const res = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH },
    body: JSON.stringify({ prompt: "Deploy a Next.js site to Vercel with a Supabase backend." }),
  });
  expect(res.status === 200 || res.status === 503 || res.status === 502, `unexpected status ${res.status}`);
  const body = await res.json();
  if (res.status === 200) {
    expect(Array.isArray(body.steps) && body.steps.length > 0, "plan has no steps");
  } else {
    expect(typeof body.error === "string", "error body missing");
  }
});

await check("GET /api/projects/:id/runs/:runId/logs streams SSE", async () => {
  const controller = new AbortController();
  const res = await fetch(`${BASE}/api/projects/smoke-test/runs/smoke-run/logs`, { signal: controller.signal, headers: { ...AUTH } });
  expect(res.ok, `status ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  expect(ct.includes("text/event-stream"), `expected SSE, got ${ct}`);
  controller.abort();
});

console.log(failures === 0 ? "\nSMOKE: ALL PASS" : `\nSMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
