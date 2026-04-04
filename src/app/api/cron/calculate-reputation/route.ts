import { NextRequest, NextResponse } from "next/server";
import { calculateAllReputationScores } from "@/lib/reputation";

// Runs nightly — recalculates reputation scores and percentiles for all candidates
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const count = await calculateAllReputationScores();
    return NextResponse.json({ message: `Updated ${count} candidates`, count });
  } catch (error) {
    console.error("Reputation calculation error:", error);
    return NextResponse.json({ error: "Failed to calculate reputation scores" }, { status: 500 });
  }
}
