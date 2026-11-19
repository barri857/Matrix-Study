import { aiRequestSchema, runAI } from "@/lib/ai";
import { body, errorResponse, json } from "../_shared";

export async function POST(request: Request) {
  try {
    const input = aiRequestSchema.parse(await body(request, 600000));
    return json(await runAI(input));
  } catch (error) { return errorResponse(error); }
}
