import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { workspaces } from "@/db/schema";
import { SafeError } from "@/lib/ai";
import { body, errorResponse, idSchema, json, sameOrigin } from "../_shared";

export const dynamic = "force-dynamic";

const timestamp = z.number().finite().nonnegative();
const title = z.string().max(300);
const subject = z.string().max(100);
const date = z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/);
const percentage = z.number().finite().min(0).max(100);
const exam = z.object({ date, time: z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d)?$/), weight: percentage, notes: z.string().max(10000) });
const blankExam = { date: '', time: '', weight: 0, notes: '' };
const courseExams = z.object({ Midterm: exam.default(blankExam), Endterm: exam, Final: exam, Custom: exam.extend({ title: z.string().max(160).default('') }).default({ ...blankExam, title: '' }) });
const httpsUrl = z.string().max(4000).url().refine(value => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password;
});
const workspaceSchema = z.object({
  version: z.literal(1),
  updatedAt: timestamp,
  tasks: z.array(z.object({ id: idSchema, title, date, subject, done: z.boolean() })).max(500),
  notes: z.array(z.object({ id: idSchema, title, body: z.string().max(30000), subject, updatedAt: timestamp })).max(100),
  bookmarks: z.array(z.object({ id: idSchema, title, url: httpsUrl, subject })).max(300),
  courses: z.record(z.string().max(100).refine(value => !["__proto__", "prototype", "constructor"].includes(value)), courseExams).refine(value => Object.keys(value).length <= 100),
  grades: z.array(z.object({ id: idSchema, title, score: percentage, weight: percentage })).max(100),
});

export async function GET() {
  try {
    const user = await getChatGPTUser();
    if (!user) return json({ authenticated: false, data: null });
    const [row] = await getDb().select({ data: workspaces.data }).from(workspaces).where(eq(workspaces.ownerId, user.userId)).limit(1);
    return json({ authenticated: true, data: row ? JSON.parse(row.data) : null });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    const user = await getChatGPTUser();
    if (!user) throw new SafeError("Sign in to sync your study workspace across devices.", 401);
    const payload = await body(request, 310000) as { data?: unknown };
    const workspace = workspaceSchema.parse(payload?.data);
    const data = JSON.stringify(workspace);
    if (new TextEncoder().encode(data).byteLength > 300000) throw new SafeError("Your workspace is too large to sync. Keep it under 300 KB by removing unused notes or tasks.", 413);
    const db = getDb();
    await db.insert(workspaces).values({ ownerId: user.userId, data, updatedAt: workspace.updatedAt }).onConflictDoUpdate({
      target: workspaces.ownerId,
      set: { data, updatedAt: workspace.updatedAt },
      setWhere: sql`${workspaces.updatedAt} <= ${workspace.updatedAt}`,
    });
    const [saved] = await db.select({ data: workspaces.data }).from(workspaces).where(eq(workspaces.ownerId, user.userId)).limit(1);
    return json({ authenticated: true, data: saved ? JSON.parse(saved.data) : workspace });
  } catch (error) { return errorResponse(error); }
}
