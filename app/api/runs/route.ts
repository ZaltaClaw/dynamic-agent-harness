import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonContentTypeBoundary, localhostRequestBoundary } from "@/app/api/runs/http";
import { getHarnessServices } from "@/lib/harness/services";
import { HarnessSpecSchema, RunPromptSchema } from "@/lib/harness/schema";

export const runtime = "nodejs";

const CreateRunSchema = z.object({
  prompt: RunPromptSchema,
  spec: HarnessSpecSchema,
});

export async function POST(request: Request) {
  const boundaryError = localhostRequestBoundary(request);
  if (boundaryError) return boundaryError;
  const contentTypeError = jsonContentTypeBoundary(request);
  if (contentTypeError) return contentTypeError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid run request" }, { status: 400 });
  }

  try {
    const input = CreateRunSchema.parse(body);
    const run = await getHarnessServices().runtime.start(input);
    return NextResponse.json({ data: run }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid run request", issues: error.issues }, { status: 400 });
    }
    console.error("Failed to start run", error);
    return NextResponse.json({ error: "Run could not be started" }, { status: 500 });
  }
}
