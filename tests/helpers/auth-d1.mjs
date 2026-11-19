import { DatabaseSync } from "node:sqlite";

/** SQLite transport exercising Better Auth's real D1 adapter, not a mock auth service. */
export function createAuthTestD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const d1 = {
    prepare(sql) {
      const bound = parameters => ({
        bind: (...values) => bound(values),
        async all() {
          const statement = sqlite.prepare(sql);
          const results = statement.all(...parameters);
          const meta = sqlite.prepare("SELECT changes() AS changes, last_insert_rowid() AS last_row_id").get();
          return { success: true, results, meta };
        },
        async run() { return this.all(); },
        async first(column) {
          const { results } = await this.all();
          return column ? results[0]?.[column] ?? null : results[0] ?? null;
        },
        async raw() {
          const statement = sqlite.prepare(sql);
          statement.setReturnArrays(true);
          return statement.all(...parameters);
        },
      });
      return bound([]);
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(sql) { sqlite.exec(sql); return { count: 1, duration: 0 }; },
  };
  return { d1, sqlite, close: () => sqlite.close() };
}
