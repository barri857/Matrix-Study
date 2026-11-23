/**
 * Local-only integration checks for the independent Matrix Worker.
 * Run against a fresh local database/server:
 *   MATRIX_TEST_URL=http://127.0.0.1:8787 node scripts/independent.test.mjs
 * Creates two disposable accounts. Passwords and cookies are held only in memory.
 * Requests never follow redirects, and no AI provider is contacted.
 */
import { randomBytes, randomUUID } from "node:crypto";

const configured = process.env.MATRIX_TEST_URL;
if (!configured) throw new Error("Set MATRIX_TEST_URL to the local Worker origin first.");
const target = new URL(configured);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  || !["http:", "https:"].includes(target.protocol)
  || !target.port || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
  throw new Error("Refusing to run: MATRIX_TEST_URL must be a loopback origin with an explicit local port. Production URLs are not allowed.");
}
const origin = target.origin;
const runId = randomUUID();
let checks = 0;
const check = (condition, label) => { if (!condition) throw new Error(label); checks++; };

class Client {
  cookies = new Map();
  cookieHeader() { return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "); }
  async request(path, { method = "GET", data, headers = {}, raw, collectCookies = true } = {}) {
    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has("Origin")) requestHeaders.set("Origin", origin);
    if (this.cookies.size && !requestHeaders.has("Cookie")) requestHeaders.set("Cookie", this.cookieHeader());
    if (data !== undefined || raw !== undefined) requestHeaders.set("Content-Type", "application/json");
    const response = await fetch(new URL(path, origin), {
      method, headers: requestHeaders, body: raw ?? (data === undefined ? undefined : JSON.stringify(data)),
      redirect: "manual", signal: AbortSignal.timeout(30000),
    });
    const setCookies = response.headers.getSetCookie();
    if (collectCookies) for (const cookie of setCookies) {
      const pair = cookie.split(";", 1)[0], separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator), value = pair.slice(separator + 1);
      if (/max-age=0(?:;|$)/i.test(cookie) || !value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("json") ? await response.json() : null;
    return { status: response.status, body, headers: response.headers, setCookies };
  }
}

const kit = (id, title, updatedAt) => ({
  id, title, subject: "Integration test", color: "#505b75", source: "Original test notes.", summary: "A local integration example.",
  guide: "## Local test\nOriginal guide.", updatedAt, apiKey: "this-field-must-not-be-stored",
  cards: [{ id: "card-one", front: "Prompt", back: "Answer", due: 800, interval: 3, reviews: 2 }],
  questions: [{ id: "question-one", prompt: "Pick the correct answer.", options: ["Correct", "Incorrect"], answer: 0, explanation: "The first option is correct.", topic: "Testing" }],
  history: [{ date: 100, score: 1, total: 1 }],
});
const workspace = (updatedAt, title) => ({
  version: 1, updatedAt, tasks: [{ id: "task-one", title, date: "2026-11-20", subject: "Test", done: false }],
  notes: [{ id: "note-one", title: "Private note", body: "Only its owner may read this.", subject: "Test", updatedAt }],
  bookmarks: [], courses: {}, grades: [], apiKey: "this-field-must-not-be-stored",
});

async function main() {
  const anonymous = new Client(), alice = new Client(), bob = new Client();
  const password = randomBytes(30).toString("base64url");
  const emails = { alice: `matrix-${runId}-alice@example.test`, bob: `matrix-${runId}-bob@example.test` };
  const config = await anonymous.request("/api/account-config");
  check(config.status === 200 && config.body?.emailPasswordEnabled === true, "Independent email account configuration is unavailable.");
  check(typeof config.body.googleReady === "boolean", "Google availability must be reported explicitly.");
  check(config.body.passwordResetEnabled === false, "Update this test when password-reset delivery is intentionally enabled.");

  const forged = { "oai-authenticated-user-id": "pretend-owner", "oai-authenticated-user-email": "owner@example.test", "OAI-Sites-Authorization": "Bearer not-a-real-platform-token" };
  let response = await anonymous.request("/api/library", { headers: forged });
  check(response.status === 200 && response.body?.user === null && response.body?.kits?.length === 0, "Forged Sites identity headers must not establish a Matrix session.");
  response = await anonymous.request("/api/library", { method: "POST", headers: forged, data: { kit: kit("forged-kit", "Forbidden", 100) } });
  check(response.status === 401, "Anonymous library writes must be rejected even with forged Sites headers.");
  response = await anonymous.request("/api/library", { headers: { Cookie: "matrix.session_token=forged" } });
  check(response.body?.user === null, "A forged Matrix cookie must not authenticate.");
  console.log("PASS anonymous access and forged identity rejection");

  response = await anonymous.request("/api/auth/sign-up/email", { method: "POST", data: { name: "Short password test", email: `matrix-${runId}-weak@example.test`, password: "short" } });
  check(response.status === 400 || response.status === 422, "Registration must reject passwords shorter than 12 characters.");
  for (const [name, client] of [["alice", alice], ["bob", bob]]) {
    response = await client.request("/api/auth/sign-up/email", { method: "POST", data: { name: `Matrix Test ${name}`, email: emails[name], password, callbackURL: "/" } });
    check(response.status === 200 || response.status === 201, `Local registration failed for disposable user ${name} (status ${response.status}). Use a fresh local database if rate limits were reached.`);
    check(response.setCookies.some(cookie => /(?:^|-)matrix\.session_token=/.test(cookie) && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie) && /Path=\//i.test(cookie)), "Session cookies must have the Matrix prefix, HttpOnly, SameSite=Lax, and root Path.");
    if (target.protocol === "https:") check(response.setCookies.some(cookie => /__Secure-matrix\.session_token=/.test(cookie) && /; Secure/i.test(cookie)), "HTTPS session cookies must be Secure.");
  }
  const aliceIdentity = await alice.request("/api/library"), bobIdentity = await bob.request("/api/library");
  const aliceId = aliceIdentity.body?.user?.id, bobId = bobIdentity.body?.user?.id;
  check(typeof aliceId === "string" && typeof bobId === "string" && aliceId !== bobId, "Disposable users must have separate authenticated owners.");
  console.log("PASS registration, password policy, and cookie attributes");

  const commonId = `integration-${runId}`;
  response = await alice.request("/api/library", { method: "POST", data: { kit: kit(commonId, "Alice original", 200) } });
  check(response.status === 200 && response.body?.kit?.title === "Alice original", "Alice's valid kit should save.");
  check(response.body.kit.apiKey === undefined, "Unknown API-key fields must be stripped from stored kits.");
  response = await alice.request("/api/library", { method: "POST", data: { kit: kit(commonId, "Alice stale", 100) } });
  check(response.status === 200 && response.body?.kit?.title === "Alice original", "Stale kit writes must preserve the newer server version.");
  response = await bob.request("/api/library", { headers: { ...forged, "oai-authenticated-user-id": aliceId } });
  check(response.body?.user?.id === bobId && response.body?.kits?.length === 0, "Spoofed Sites headers must not override Bob's signed session or expose Alice's data.");
  response = await bob.request("/api/share", { method: "POST", data: { id: commonId, enabled: true } });
  check(response.status === 404, "A user must not publish another owner's kit.");
  await bob.request(`/api/library?id=${encodeURIComponent(commonId)}`, { method: "DELETE" });
  response = await alice.request("/api/library");
  check(response.body?.kits?.some(item => item.id === commonId), "Deleting an absent owned ID must not delete another user's matching kit.");
  response = await bob.request("/api/library", { method: "POST", data: { kit: kit(commonId, "Bob separate copy", 300) } });
  check(response.status === 200, "Different owners must be able to store the same local kit ID independently.");
  response = await alice.request("/api/library");
  check(response.body?.kits?.find(item => item.id === commonId)?.title === "Alice original", "Bob's matching ID must not overwrite Alice's kit.");

  response = await alice.request("/api/workspace", { method: "PUT", data: { data: workspace(200, "Alice task") } });
  check(response.status === 200 && response.body?.data?.apiKey === undefined, "A workspace should save and strip unknown secret fields.");
  response = await alice.request("/api/workspace", { method: "PUT", data: { data: workspace(100, "Stale task") } });
  check(response.body?.data?.tasks?.[0]?.title === "Alice task", "Stale workspace writes must preserve newer data.");
  response = await bob.request("/api/workspace");
  check(response.status === 200 && response.body?.authenticated === true && response.body?.data === null, "Bob must not receive Alice's workspace.");
  console.log("PASS owner isolation and stale-write protection");

  response = await alice.request("/api/share", { method: "POST", data: { id: commonId, enabled: true } });
  const shareId = response.body?.shareId;
  check(response.status === 200 && typeof shareId === "string", "An owner must be able to enable a public share.");
  response = await anonymous.request(`/api/share?id=${encodeURIComponent(shareId)}`);
  check(response.status === 200 && response.body?.kit?.title === "Alice original", "Enabled public shares must be available without signing in.");
  check(response.body.kit.id !== commonId && response.body.kit.history.length === 0 && response.body.kit.cards[0].due === undefined && response.body.kit.cards[0].reviews === undefined, "Shared copies must get a new kit ID and exclude private learning progress.");
  check(response.body.kit.ownerId === undefined && response.body.kit.apiKey === undefined && response.body.kit.email === undefined, "Shared content must not reveal account identifiers or API keys.");
  check(response.headers.get("cache-control") === "no-store", "Share responses must not stay cached after revocation.");
  await alice.request("/api/share", { method: "POST", data: { id: commonId, enabled: false } });
  response = await anonymous.request(`/api/share?id=${encodeURIComponent(shareId)}`);
  check(response.status === 404, "Revoked share links must immediately stop returning content.");
  console.log("PASS public sharing, privacy, and revocation");

  const hostile = { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" };
  for (const [path, method, data] of [
    ["/api/library", "POST", { kit: kit("csrf", "Forbidden", 1) }],
    [`/api/library?id=${encodeURIComponent(commonId)}`, "DELETE", undefined],
    ["/api/workspace", "PUT", { data: workspace(300, "Forbidden") }],
    ["/api/share", "POST", { id: commonId, enabled: true }],
    ["/api/auth/sign-out", "POST", {}],
  ]) {
    response = await alice.request(path, { method, data, headers: hostile });
    check(response.status === 403, `Cross-origin ${method} ${path.split("?")[0]} must be rejected (status ${response.status}).`);
  }
  response = await alice.request("/api/library");
  check(response.body?.user?.id === aliceId, "Rejected cross-origin sign-out must leave the valid session intact.");
  response = await alice.request("/api/library", { method: "POST", raw: JSON.stringify({ padding: "x".repeat(530000) }) });
  check(response.status === 413, "Library bodies above the accepted size must be rejected before parsing.");
  response = await alice.request("/api/workspace", { method: "PUT", raw: JSON.stringify({ padding: "x".repeat(320000) }) });
  check(response.status === 413, "Workspace bodies above the accepted size must be rejected before parsing.");
  response = await anonymous.request("/api/auth/sign-in/email", { method: "POST", raw: JSON.stringify({ padding: "x".repeat(1024 * 1024) }) });
  check(response.status === 413, "Auth handlers must reject oversized bodies before Better Auth parses them.");
  console.log("PASS cross-origin protections and request-size limits");

  const revokedCookie = alice.cookieHeader();
  response = await alice.request("/api/auth/sign-out", { method: "POST", data: {} });
  check(response.status === 200, "Local sign-out should succeed.");
  response = await alice.request("/api/library");
  check(response.body?.user === null, "Sign-out must clear the active session cookie.");
  response = await anonymous.request("/api/library", { headers: { Cookie: revokedCookie } });
  check(response.body?.user === null, "A copied session cookie must stop working after server-side sign-out.");
  response = await alice.request("/api/auth/sign-in/email", { method: "POST", data: { email: emails.alice, password, callbackURL: "/" } });
  check(response.status === 200, `Email sign-in failed (status ${response.status}).`);
  response = await alice.request("/api/library");
  check(response.body?.user?.id === aliceId && response.body?.kits?.find(item => item.id === commonId)?.title === "Alice original", "Signing back in must restore only the same owner's library.");
  response = await anonymous.request("/api/auth/sign-in/email", { method: "POST", data: { email: emails.alice, password: randomBytes(24).toString("base64url"), callbackURL: "/" } });
  check(response.status === 401 || response.status === 400, "An incorrect password must not create a session.");

  await alice.request(`/api/library?id=${encodeURIComponent(commonId)}`, { method: "DELETE" });
  await bob.request(`/api/library?id=${encodeURIComponent(commonId)}`, { method: "DELETE" });
  await alice.request("/api/auth/sign-out", { method: "POST", data: {} });
  await bob.request("/api/auth/sign-out", { method: "POST", data: {} });
  console.log(`PASS logout, session revocation, and login; ${checks} integration checks passed.`);
}

main().catch(error => {
  console.error(`FAIL ${error instanceof Error ? error.message : "Independent Worker integration checks failed."}`);
  process.exitCode = 1;
});
