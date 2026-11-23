import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { kits } from "@/db/schema";
import { SafeError } from "@/lib/ai";
import { body, errorResponse, idSchema, json, kitSchema, sameOrigin } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    const [row] = await getDb().select({ data: kits.data }).from(kits).where(eq(kits.shareId, id)).limit(1);
    if (!row) throw new SafeError("This shared kit is unavailable or its owner has stopped sharing it.", 404);
    const saved = kitSchema.parse(JSON.parse(row.data));
    // Learning history is personal. A shared kit always starts with fresh progress.
    const shared = { ...saved, id: crypto.randomUUID(), demo: false, history: [], createdAt: Date.now(), updatedAt: Date.now(), cards: saved.cards.map(({ id, front, back }) => ({ id, front, back })) };
    return json({ kit: shared });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await getChatGPTUser();
    if (!user) throw new SafeError("Sign in to share a kit with a public link.", 401);
    const input = z.object({ id: idSchema, enabled: z.boolean() }).parse(await body(request, 2000));
    const db = getDb();
    const owned = and(eq(kits.ownerId, user.userId), eq(kits.id, input.id));
    const [saved] = await db.update(kits).set({
      shareId: input.enabled ? sql`coalesce(${kits.shareId}, ${crypto.randomUUID()})` : null,
    }).where(owned).returning({ shareId: kits.shareId });
    if (!saved) throw new SafeError("Save this kit to your cloud library before sharing it.", 404);
    return json(saved);
  } catch (error) { return errorResponse(error); }
}
