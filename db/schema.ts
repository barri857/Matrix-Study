import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const kits = sqliteTable("kits", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  data: text("data").notNull(),
  updatedAt: integer("updated_at").notNull(),
  shareId: text("share_id"),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.id] }),
  uniqueIndex("kits_share_id_unique").on(table.shareId),
]);

export const workspaces = sqliteTable("workspaces", {
  ownerId: text("owner_id").primaryKey(),
  data: text("data").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
