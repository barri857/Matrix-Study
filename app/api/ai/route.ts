import { aiRequestSchema, runAI, MAX_AI_REQUEST_BYTES } from "@/lib/ai";
import { body, errorResponse, json } from "../_shared";

export async function POST(request: Request) {
  try {
    const input = aiRequestSchema.parse(await body(request, MAX_AI_REQUEST_BYTES));
    return json(await runAI(input));
  } catch (error) { return errorResponse(error); }
}
