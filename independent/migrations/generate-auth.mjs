// Run with Node 24+: node independent/migrations/generate-auth.mjs
// Generates SQL locally only; never opens a deployed database or reads production secrets.
import { writeFile } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../auth.ts";
import { createAuthTestD1 } from "../../tests/helpers/auth-d1.mjs";

const database = createAuthTestD1();
try {
  const auth = createAuth({
    DB: database.d1,
    APP_URL: "https://matrix.example",
    BETTER_AUTH_SECRET: "schema-generation-local-placeholder-only-123456789",
  });
  const migration = await getMigrations(auth.options);
  if (migration.unsafeChanges.length || migration.schemaProblems.length) {
    throw new Error("Auth schema generation reported unsafe changes or schema problems.");
  }
  const sql = await migration.compileMigrations();
  await writeFile(new URL("0001_auth.sql", import.meta.url),
    "-- Generated from Better Auth 1.7.26 and independent/auth.ts.\n" +
    "-- Regenerate locally with: node independent/migrations/generate-auth.mjs\n" + sql + "\n");
  console.log(`Generated ${migration.toBeCreated.length} authentication tables.`);
} finally {
  database.close();
}
