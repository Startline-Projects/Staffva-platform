import { notFound } from "next/navigation";
import { loadSpecialistRecord } from "@/lib/adminPeople";
import SpecialistRecordView from "@/components/admin/SpecialistRecordView";

export const dynamic = "force-dynamic";

export default async function SpecialistRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await loadSpecialistRecord(id);
  if (!record) notFound();
  return <SpecialistRecordView record={record} />;
}
