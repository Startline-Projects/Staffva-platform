import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { candidateId } = await request.json();

  if (!candidateId) {
    return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
  }

  // TODO: Send email notification via Resend when API key is configured
  // For now, just log it — the Resend integration will be connected later
  console.log(
    `[StaffVA] New candidate submission ready for review: ${candidateId}`
  );

  return NextResponse.json({ success: true });
}
