import { and, desc, eq, sql } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { kits } from "@/db/schema";
import { SafeError } from "@/lib/ai";
import { body, errorResponse, idSchema, json, kitSchema, sameOrigin } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getChatGPTUser();
    if (!user) return json({ user: null, kits: [] });
    const rows = await getDb().select().from(kits).where(eq(kits.ownerId, user.userId)).orderBy(desc(kits.updatedAt)).limit(100);
    return json({ user: { id: user.userId, name: user.displayName }, kits: rows.map(row => ({ ...JSON.parse(row.data), shareId: row.shareId })) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await getChatGPTUser();
    if (!user) throw new SafeError("Sign in to save your library across devices.", 401);
    const payload = await body(request) as { kit?: unknown };
    const kit = kitSchema.parse(payload?.kit);
    const data = JSON.stringify(kit);
    if (new TextEncoder().encode(data).byteLength > 500000) throw new SafeError("This kit is too large to sync. Keep it under 500 KB by shortening its source or guide.", 413);
    const db = getDb();
    // The count guard and upsert run in one statement so concurrent creates cannot exceed the account limit.
    await db.run(sql`INSERT INTO kits (owner_id, id, data, updated_at)
      SELECT ${user.userId}, ${kit.id}, ${data}, ${kit.updatedAt}
      WHERE (SELECT COUNT(*) FROM kits WHERE owner_id = ${user.userId}) < 100
         OR EXISTS(SELECT 1 FROM kits WHERE owner_id = ${user.userId} AND id = ${kit.id})
      ON CONFLICT(owner_id, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
      WHERE excluded.updated_at >= kits.updated_at`);
    const [saved] = await db.select().from(kits).where(and(eq(kits.ownerId, user.userId), eq(kits.id, kit.id))).limit(1);
    if (!saved) throw new SafeError("Your cloud library holds 100 kits. Remove a kit before adding another.", 409);
    return json({ kit: { ...JSON.parse(saved.data), shareId: saved.shareId } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const user = await getChatGPTUser();
    if (!user) throw new SafeError("Sign in to manage your cloud library.", 401);
    const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
    await getDb().delete(kits).where(and(eq(kits.ownerId, user.userId), eq(kits.id, id)));
    return json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
