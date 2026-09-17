import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPersonRecordings } from "@/lib/adminRecordings";
import PersonRecordingsView from "@/components/admin/recordings/PersonRecordingsView";

export const dynamic = "force-dynamic";

export default async function PersonRecordingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ candidateId: string }>;
  searchParams: Promise<{ open?: string }>;
}) {
  const [{ candidateId }, { open }] = await Promise.all([params, searchParams]);
  const data = await loadPersonRecordings(candidateId);

  if (data === "not_found") notFound();

  if (!data) {
    return (
      <div className="adm-col" style={{ maxWidth: 1000 }}>
        <Link href="/admin/video-reviews" className="rec-back">← All recordings</Link>
        <div className="adm-state error" role="alert">
          <strong>This person&apos;s recordings could not be read.</strong>
          <p style={{ marginTop: 8 }}>
            A failed read, not an empty folder — or your role does not include assessment footage, which is limited to
            administrators and recruiting managers.
          </p>
        </div>
      </div>
    );
  }

  return <PersonRecordingsView data={data} initialOpen={open ?? null} />;
}
