import { NextResponse } from "next/server";
import { loadDisputes, isDisputeStaff, type DisputeStatus } from "@/lib/adminDisputes";

/**
 * Kept as an endpoint, but the query lives in `src/lib/adminDisputes.ts` so
 * this and the admin page cannot drift into describing the queue differently.
 */
export async function GET(request: Request) {
  if (!(await isDisputeStaff())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status: DisputeStatus = searchParams.get("status") === "resolved" ? "resolved" : "open";

  const disputes = await loadDisputes(status);
  if (!disputes) {
    return NextResponse.json({ error: "Could not read disputes" }, { status: 500 });
  }

  return NextResponse.json({ disputes });
}
