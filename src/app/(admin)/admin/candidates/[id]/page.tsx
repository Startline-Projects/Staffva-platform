import { notFound } from "next/navigation";
import { getUser } from "@/lib/auth";
import { loadCandidateRecord } from "@/lib/adminCandidate";
import CandidateRecordView from "@/components/admin/CandidateRecordView";

export const dynamic = "force-dynamic";

export default async function CandidateRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [record, user] = await Promise.all([loadCandidateRecord(id), getUser()]);

  // The loader returns null both for "no such candidate" and for "you are not
  // staff". The layout has already settled the second, so this is the first.
  if (!record) notFound();

  return <CandidateRecordView record={record} canDecide={user?.app_metadata?.role === "admin"} />;
}
