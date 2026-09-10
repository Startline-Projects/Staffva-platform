import { notFound } from "next/navigation";
import { loadClientRecord } from "@/lib/adminPeople";
import ClientRecordView from "@/components/admin/ClientRecordView";

export const dynamic = "force-dynamic";

export default async function ClientRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await loadClientRecord(id);
  if (!record) notFound();
  return <ClientRecordView record={record} />;
}
