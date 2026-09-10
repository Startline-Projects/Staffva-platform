import { notFound } from "next/navigation";
import { loadJob } from "@/lib/adminJobs";
import JobDetailView from "@/components/admin/JobDetailView";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await loadJob(id);
  if (!record) notFound();
  return <JobDetailView record={record} />;
}
