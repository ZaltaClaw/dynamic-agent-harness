import { NextResponse } from "next/server";
import { z } from "zod";
import {
  PUBLIC_IDENTIFIER_MAX_LENGTH,
  isPublicIdentifier,
  jsonContentTypeBoundary,
  localhostRequestBoundary,
} from "@/app/api/runs/http";
import { getHarnessServices } from "@/lib/harness/services";

export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string }> };

const ApprovalSchema = z.object({
  approvalId: z.string()
    .trim()
    .min(1)
    .max(PUBLIC_IDENTIFIER_MAX_LENGTH)
    .refine(isPublicIdentifier, { message: "Invalid approval id" }),
  decision: z.enum(["allow", "deny"]),
});

export async function POST(request: Request, context: Context) {
  const boundaryError = localhostRequestBoundary(request);
  if (boundaryError) return boundaryError;
  const contentTypeError = jsonContentTypeBoundary(request);
  if (contentTypeError) return contentTypeError;

  let runId: string;
  try {
    ({ runId } = await context.params);
  } catch (error) {
    console.error("Failed to resolve approval", error);
    return NextResponse.json({ error: "Approval could not be resolved" }, { status: 500 });
  }

  if (!isPublicIdentifier(runId)) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid approval request" }, { status: 400 });
  }

  const parsed = ApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid approval request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const services = getHarnessServices();
  try {
    const run = await services.store.getRun(runId);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    if (
      run.status !== "waiting_for_approval"
      || run.pendingApprovalId !== parsed.data.approvalId
    ) {
      return NextResponse.json({ error: "Approval conflict" }, { status: 409 });
    }

    const resolved = await services.runtime.resolveApproval({ runId, ...parsed.data });
    return NextResponse.json({ data: resolved });
  } catch (error) {
    try {
      const latest = await services.store.getRun(runId);
      if (latest === null) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      if (
        latest
        && (latest.status !== "waiting_for_approval" || latest.pendingApprovalId !== parsed.data.approvalId)
      ) {
        return NextResponse.json({ error: "Approval conflict" }, { status: 409 });
      }
    } catch (stateError) {
      console.error("Failed to inspect approval state", stateError);
    }
    console.error("Failed to resolve approval", error);
    return NextResponse.json({ error: "Approval could not be resolved" }, { status: 500 });
  }
}
