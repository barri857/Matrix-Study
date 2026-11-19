import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { createAuth, getAuthConfig, getUser } from "../independent/auth.ts";
import { createAuthTestD1 } from "./helpers/auth-d1.mjs";

const origin = "https://matrix.example";
const password = "Correct matrix horse battery 73";
const secret = "authentication-test-fixture-not-a-production-secret-281c7";
async function fixture() {
  const database = createAuthTestD1();
  await database.d1.exec(await readFile(new URL("../independent/migrations/0001_auth.sql", import.meta.url), "utf8"));
  return { ...database, env: { DB: database.d1, APP_URL: origin, BETTER_AUTH_SECRET: secret } };
}
function request(path, body, options = {}) {
  return new Request(`${origin}/api/auth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      origin: options.origin ?? origin,
      "cf-connecting-ip": options.ip ?? "192.0.2.30",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function cookies(response) {
  return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}

test("generated D1 migration exactly matches auth's expected schema", async () => {
  const f = await fixture();
  try {
    const migration = await getMigrations(createAuth(f.env).options);
    assert.deepEqual(migration.toBeCreated, []);
    assert.deepEqual(migration.toBeAdded, []);
    assert.deepEqual(migration.toBeAddedIndexes, []);
    assert.deepEqual(migration.unsafeChanges, []);
    assert.deepEqual(migration.schemaProblems, []);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'auth_%'").get().n, 5);
  } finally { f.close(); }
});

test("signup, sign-in and sign-out use secure verified sessions; identity headers cannot authenticate", async () => {
  const f = await fixture();
  try {
    const handler = req => createAuth(f.env).handler(req);
    assert.equal(await getUser(request("get-session", undefined, { headers: {
      "oai-authenticated-user-id": "owner", "oai-authenticated-user-email": "owner@example.com",
    } }), f.env), null);
    const short = await handler(request("sign-up/email", { name: "Alice", email: "alice@example.com", password: "short" }));
    assert.equal(short.status, 400);
    const signup = await handler(request("sign-up/email", { name: "Alice", email: "alice@example.com", password }));
    assert.equal(signup.status, 200, JSON.stringify(await signup.clone().json()));
    const user = (await signup.json()).user;
    const cookie = cookies(signup);
    assert.match(cookie, /__Secure-matrix\.session_token=/);
    const sessionCookie = signup.headers.getSetCookie().find(value => value.includes("session_token="));
    assert.match(sessionCookie, /; Secure/i);
    assert.match(sessionCookie, /; HttpOnly/i);
    assert.match(sessionCookie, /; SameSite=Lax/i);
    assert.equal(user.emailVerified, false);
    assert.deepEqual(await getUser(request("get-session", undefined, { cookie }), f.env), { userId: user.id, displayName: "Alice" });
    assert.equal(await getUser(request("get-session", undefined, { cookie: cookie.replace("session_token=", "session_token=tampered") }), f.env), null);
    const row = f.sqlite.prepare("SELECT password FROM auth_account WHERE userId = ?").get(user.id);
    assert.notEqual(row.password, password);
    assert.match(row.password, /^[0-9a-f]+:[0-9a-f]+$/);
    const wrong = await handler(request("sign-in/email", { email: "alice@example.com", password: "This is the wrong password" }));
    assert.equal(wrong.status, 401);
    const signin = await handler(request("sign-in/email", { email: "alice@example.com", password }));
    assert.equal(signin.status, 200);
    const signedInCookie = cookies(signin);
    const signout = await handler(request("sign-out", {}, { cookie: signedInCookie }));
    assert.equal(signout.status, 200);
    assert.equal(await getUser(request("get-session", undefined, { cookie: signedInCookie }), f.env), null);
    assert.equal((await getUser(request("get-session", undefined, { cookie }), f.env)).userId, user.id);
  } finally { f.close(); }
});

test("cross-origin signups and external callback redirects are rejected", async () => {
  const f = await fixture();
  try {
    const handler = req => createAuth(f.env).handler(req);
    const foreign = await handler(request("sign-up/email", { name: "Alice", email: "alice@example.com", password }, { origin: "https://attacker.example" }));
    assert.equal(foreign.status, 403);
    const redirect = await handler(request("sign-up/email", {
      name: "Alice", email: "alice@example.com", password, callbackURL: "https://attacker.example",
    }));
    assert.equal(redirect.status, 403);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM auth_user").get().n, 0);
  } finally { f.close(); }
});

test("name bounds run before signup hashing and also protect profile updates", async () => {
  const f = await fixture();
  try {
    const auth = createAuth(f.env);
    const context = await auth.$context;
    const originalHash = context.password.hash;
    let hashCalls = 0;
    context.password.hash = async value => { hashCalls++; return originalHash(value); };
    for (const name of ["   ", "x".repeat(101)]) {
      const invalid = await auth.handler(request("sign-up/email", { name, email: "alice@example.com", password }));
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).code, "INVALID_NAME");
    }
    assert.equal(hashCalls, 0);
    const signup = await auth.handler(request("sign-up/email", { name: " Alice ", email: "alice@example.com", password }));
    assert.equal(signup.status, 200);
    const cookie = cookies(signup);
    assert.equal((await signup.json()).user.name, "Alice");
    const update = await auth.handler(request("update-user", { name: "x".repeat(101) }, { cookie }));
    assert.equal(update.status, 400);
    assert.equal((await getUser(request("get-session", undefined, { cookie }), f.env)).displayName, "Alice");
  } finally { f.close(); }
});

test("password changes require the current password and can revoke other sessions", async () => {
  const f = await fixture();
  try {
    const handler = req => createAuth(f.env).handler(req);
    const signup = await handler(request("sign-up/email", { name: "Alice", email: "alice@example.com", password }));
    const firstCookie = cookies(signup);
    const signin = await handler(request("sign-in/email", { email: "alice@example.com", password }));
    const currentCookie = cookies(signin);
    const wrong = await handler(request("change-password", {
      currentPassword: "wrong password", newPassword: "A replacement password 283", revokeOtherSessions: true,
    }, { cookie: currentCookie }));
    assert.equal(wrong.status, 400);
    const changed = await handler(request("change-password", {
      currentPassword: password, newPassword: "A replacement password 283", revokeOtherSessions: true,
    }, { cookie: currentCookie }));
    assert.equal(changed.status, 200);
    assert.equal(await getUser(request("get-session", undefined, { cookie: firstCookie }), f.env), null);
    const old = await handler(request("sign-in/email", { email: "alice@example.com", password }));
    assert.equal(old.status, 401);
    const fresh = await handler(request("sign-in/email", { email: "alice@example.com", password: "A replacement password 283" }));
    assert.equal(fresh.status, 200);
  } finally { f.close(); }
});

test("rate limit survives request-scoped auth instances and ignores spoofed forwarding headers", async () => {
  const f = await fixture();
  try {
    const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) => createAuth(f.env).handler(request("sign-in/email", {
      email: "missing@example.com", password,
    }, { headers: { "x-forwarded-for": `198.51.100.${i}` } }))));
    assert.equal(attempts.filter(response => response.status === 401).length, 5);
    assert.equal(attempts.filter(response => response.status === 429).length, 3);
    const blocked = await createAuth(f.env).handler(request("sign-in/email", { email: "missing@example.com", password }));
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("x-retry-after")) > 0);
    assert.ok(f.sqlite.prepare("SELECT count(*) AS n FROM auth_rate_limit").get().n > 0);
    const other = await createAuth(f.env).handler(request("sign-in/email", { email: "missing@example.com", password }, { ip: "192.0.2.31" }));
    assert.equal(other.status, 401);
  } finally { f.close(); }
});

test("recovery and Google availability are truthful and missing setup fails safely", async () => {
  const f = await fixture();
  try {
    const config = getAuthConfig(f.env);
    assert.equal(config.googleReady, false);
    assert.equal(config.passwordResetEnabled, false);
    assert.equal(config.emailVerificationEnabled, false);
    assert.equal(JSON.stringify(config).includes(secret), false);
    const reset = await createAuth(f.env).handler(request("request-password-reset", { email: "alice@example.com" }));
    assert.equal(reset.status, 400);
    assert.equal((await reset.json()).code, "RESET_PASSWORD_DISABLED");
    const google = await createAuth(f.env).handler(request("sign-in/social", { provider: "google" }));
    assert.equal(google.status, 404);
    assert.equal(getAuthConfig({ ...f.env, GOOGLE_CLIENT_ID: "configured" }).googleReady, false);
    const configured = { ...f.env, GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-secret" };
    assert.equal(getAuthConfig(configured).googleReady, true);
    const auth = createAuth(configured);
    assert.equal(auth.options.account.accountLinking.enabled, false);
    assert.equal(auth.options.account.accountLinking.disableImplicitLinking, true);
    assert.equal(auth.options.user.validateUserInfo({ user: { emailVerified: false }, source: { method: "oauth", oauth: { providerId: "google" } } }).error, "EMAIL_NOT_VERIFIED");
    assert.equal(auth.options.user.validateUserInfo({ user: { emailVerified: true }, source: { method: "oauth", oauth: { providerId: "google" } } }), undefined);
    const redirect = await auth.handler(request("sign-in/social", { provider: "google", callbackURL: "/", disableRedirect: true }));
    assert.equal(redirect.status, 200);
    const oauthURL = new URL((await redirect.json()).url);
    assert.equal(oauthURL.hostname, "accounts.google.com");
    assert.equal(oauthURL.searchParams.get("redirect_uri"), `${origin}/api/auth/callback/google`);
    assert.ok(oauthURL.searchParams.get("state"));
    assert.ok(oauthURL.searchParams.get("code_challenge"));
    assert.throws(() => createAuth({ ...f.env, BETTER_AUTH_SECRET: "short" }), /BETTER_AUTH_SECRET/);
    assert.throws(() => createAuth({ ...f.env, APP_URL: "http://matrix.example" }), /HTTPS/);
    assert.throws(() => createAuth({ ...f.env, APP_URL: "https://matrix.example/untrusted" }), /HTTPS/);
  } finally { f.close(); }
});
