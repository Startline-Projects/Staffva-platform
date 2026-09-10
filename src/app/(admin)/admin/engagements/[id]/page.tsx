import { notFound } from "next/navigation";
import { loadEngagement } from "@/lib/adminEngagements";
import EngagementDetailView from "@/components/admin/EngagementDetailView";

export const dynamic = "force-dynamic";

export default async function EngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await loadEngagement(id);
  if (!record) notFound();
  return <EngagementDetailView record={record} />;
}
