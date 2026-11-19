import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import { drizzle } from "drizzle-orm/d1";

// The real route handlers and Drizzle SQL run against SQLite. Only platform identity
// and the D1 transport are substituted; no provider requests or cloud writes occur.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function route(name) {
  const result = await build({
    entryPoints: [resolve(root, `app/api/${name}/route.ts`)], bundle: true, write: false, format: "esm", platform: "node", target: "node24", tsconfig: resolve(root, "tsconfig.json"),
    plugins: [{ name: "test-platform", setup(builder) {
      builder.onResolve({ filter: /^@\/(db|app\/chatgpt-auth)$/ }, args => ({ path: args.path, namespace: "matrix-test" }));
      builder.onLoad({ filter: /.*/, namespace: "matrix-test" }, args => ({ contents: args.path === "@/db"
        ? "export function getDb() { return globalThis.__matrixTestDb; }"
        : "export async function getChatGPTUser() { return globalThis.__matrixTestUser; }", loader: "js" }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const library = await route("library");
const sharing = await route("share");
const workspace = await route("workspace");
const payload = (path, data, origin = "https://matrix.test") => new Request(`https://matrix.test/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(data) });
const sample = (id, title = "Study kit", updatedAt = 100) => ({
  id, title, subject: "Biology", color: "green", source: "Source text", summary: "Summary", guide: "Guide", updatedAt,
  cards: [{ id: "c1", front: "Question", back: "Answer", due: 200, interval: 3, reviews: 1 }],
  questions: [{ id: "q1", prompt: "Question", options: ["A", "B"], answer: 0, explanation: "A is right", topic: "Topic" }],
  history: [{ date: 100, score: 1, total: 1 }],
});

test("owned libraries, limits, stale updates, share revocation and private progress are enforced", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(await readFile(resolve(root, "drizzle/0000_ordinary_justin_hammer.sql"), "utf8"));
  const d1 = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    const bound = params => ({
      bind: (...values) => bound(values),
      async run() { return { success: true, meta: statement.run(...params), results: [] }; },
      async all() { return { success: true, results: statement.all(...params) }; },
      async raw() { statement.setReturnArrays(true); return statement.all(...params); },
    });
    return bound([]);
  } };
  globalThis.__matrixTestDb = drizzle(d1);
  globalThis.__matrixTestUser = null;
  assert.deepEqual(await (await library.GET()).json(), { user: null, kits: [] });
  assert.equal((await library.POST(payload("library", { kit: sample("private") }))).status, 401);
  assert.deepEqual(await (await workspace.GET()).json(), { authenticated: false, data: null });
  assert.equal((await workspace.PUT(payload("workspace", { data: {} }))).status, 401);

  globalThis.__matrixTestUser = { userId: "alice", displayName: "Alice" };
  assert.equal((await library.POST(payload("library", { kit: { ...sample("private", "Alice's notes"), apiKey: "must-not-save" } }))).status, 200);
  assert.equal((await library.POST(payload("library", { kit: sample("private", "Stale text", 99) }))).status, 200);
  const alice = await (await library.GET()).json();
  assert.equal(alice.kits[0].title, "Alice's notes");
  assert.equal(alice.kits[0].apiKey, undefined);
  assert.equal((await library.POST(payload("library", { kit: sample("bad-origin") }, "https://attacker.test"))).status, 403);
  const planner = { version: 1, updatedAt: 100, tasks: [{ id: "task1", title: "Review", date: "2026-11-20", subject: "Biology", done: false }], notes: [], bookmarks: [], courses: {}, grades: [] };
  assert.equal((await workspace.PUT(payload("workspace", { data: { ...planner, apiKey: "must-not-save" } }))).status, 200);
  assert.equal((await workspace.PUT(payload("workspace", { data: { ...planner, updatedAt: 99, tasks: [] } }))).status, 200);
  assert.equal((await (await workspace.GET()).json()).data.tasks.length, 1);
  assert.equal((await (await workspace.GET()).json()).data.apiKey, undefined);
  assert.equal((await workspace.PUT(payload("workspace", { data: { ...planner, bookmarks: [{ id: "unsafe", title: "Bad", url: "javascript:alert(1)", subject: "" }] } }))).status, 400);
  assert.equal((await workspace.PUT(payload("workspace", { data: planner }, "https://attacker.test"))).status, 403);
  const share = await (await sharing.POST(payload("share", { id: "private", enabled: true }))).json();
  assert.match(share.shareId, /^[a-f0-9-]{36}$/);

  globalThis.__matrixTestUser = { userId: "bob", displayName: "Bob" };
  assert.equal((await (await library.GET()).json()).kits.length, 0);
  assert.deepEqual(await (await workspace.GET()).json(), { authenticated: true, data: null });
  assert.equal((await sharing.POST(payload("share", { id: "private", enabled: true }))).status, 404);
  await library.DELETE(new Request("https://matrix.test/api/library?id=private", { method: "DELETE" }));
  assert.equal((await library.POST(payload("library", { kit: sample("private", "Bob's notes") }))).status, 200);
  assert.equal((await (await library.GET()).json()).kits[0].title, "Bob's notes");
  const shared = await (await sharing.GET(new Request(`https://matrix.test/api/share?id=${share.shareId}`))).json();
  assert.equal(shared.kit.title, "Alice's notes");
  assert.deepEqual(shared.kit.history, []);
  assert.equal(shared.kit.cards[0].due, undefined);
  assert.notEqual(shared.kit.id, "private");

  globalThis.__matrixTestUser = { userId: "alice", displayName: "Alice" };
  assert.equal((await (await library.GET()).json()).kits[0].title, "Alice's notes");
  await sharing.POST(payload("share", { id: "private", enabled: false }));
  assert.equal((await sharing.GET(new Request(`https://matrix.test/api/share?id=${share.shareId}`))).status, 404);
  for (let i = 0; i < 99; i++) assert.equal((await library.POST(payload("library", { kit: sample(`kit-${i}`) }))).status, 200);
  assert.equal((await library.POST(payload("library", { kit: sample("overflow") }))).status, 409);
  assert.equal((await library.POST(payload("library", { kit: sample("private", "Updated at capacity", 200) }))).status, 200);
  assert.equal((await (await library.GET()).json()).kits.length, 100);
  sqlite.close();
  delete globalThis.__matrixTestDb;
  delete globalThis.__matrixTestUser;
});
