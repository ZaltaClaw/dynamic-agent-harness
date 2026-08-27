import { NextResponse } from "next/server";
import { isPublicIdentifier, localhostRequestBoundary } from "@/app/api/runs/http";
import { getHarnessServices } from "@/lib/harness/services";

export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string }> };

export async function GET(request: Request, context: Context) {
  const boundaryError = localhostRequestBoundary(request);
  if (boundaryError) return boundaryError;

  try {
    const { runId } = await context.params;
    if (!isPublicIdentifier(runId)) {
      return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
    }

    const run = await getHarnessServices().store.getRun(runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json({ data: run });
  } catch (error) {
    console.error("Failed to load run", error);
    return NextResponse.json({ error: "Run could not be loaded" }, { status: 500 });
  }
}
