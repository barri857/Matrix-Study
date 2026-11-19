import { z } from "zod";
import { SafeError, readBoundedJson } from "@/lib/ai";
import { isGuideImageData, MAX_GUIDE_IMAGES, MAX_GUIDE_IMAGE_EDGE, MAX_GUIDE_IMAGE_TOTAL } from "@/lib/study";

export const idSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const finite = z.number().finite().nonnegative();
const card = z.object({
  id: idSchema,
  front: z.string().min(1).max(5000),
  back: z.string().min(1).max(10000),
  due: finite.optional(), interval: finite.optional(), ease: finite.optional(), reviews: finite.optional(), mastered: z.boolean().optional(),
});
const question = z.object({
  id: idSchema, prompt: z.string().min(1).max(5000),
  options: z.array(z.string().min(1).max(2000)).min(2).max(6),
  answer: z.number().int().min(0).max(5), explanation: z.string().max(10000), topic: z.string().max(200),
}).refine(value => value.answer < value.options.length);
const guideImages = z.array(z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(160),
  data: z.string().refine(isGuideImageData),
  width: z.number().int().min(1).max(MAX_GUIDE_IMAGE_EDGE),
  height: z.number().int().min(1).max(MAX_GUIDE_IMAGE_EDGE),
})).max(MAX_GUIDE_IMAGES).refine(images =>
  new Set(images.map(image => image.id)).size === images.length &&
  images.reduce((bytes, image) => bytes + image.data.length, 0) <= MAX_GUIDE_IMAGE_TOTAL);
export const kitSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(160),
  subject: z.string().max(160).default("General"),
  color: z.string().max(80).default("green"),
  source: z.string().max(200000).default(""),
  summary: z.string().max(20000).default(""),
  guide: z.string().max(100000).default(""),
  guideImages: guideImages.optional(),
  cards: z.array(card).max(200),
  questions: z.array(question).max(200),
  updatedAt: finite,
  createdAt: finite.optional(),
  demo: z.boolean().optional(),
  history: z.array(z.object({ date: finite, score: finite, total: finite })).max(500).optional(),
});

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || (origin && origin !== new URL(request.url).origin)) throw new SafeError("This request must come from Matrix.", 403);
}

export async function body(request: Request, maxBytes = 520000) {
  sameOrigin(request);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new SafeError("Send this request as JSON.", 415);
  return readBoundedJson(request, maxBytes);
}

export function errorResponse(error: unknown) {
  if (error instanceof SafeError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return json({ error: "Some information is missing or invalid. Check your input and try again." }, 400);
  return json({ error: "Matrix could not complete this request. Please try again shortly." }, 500);
}
