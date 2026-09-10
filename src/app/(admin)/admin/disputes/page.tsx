import { loadDisputes, type DisputeStatus } from "@/lib/adminDisputes";
import DisputeListView from "@/components/admin/DisputeListView";

export const dynamic = "force-dynamic";

export default async function DisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status: DisputeStatus = sp.status === "resolved" ? "resolved" : "open";
  const disputes = await loadDisputes(status);

  // null is a failed read, [] is an empty queue. On a page about money in
  // escrow those two must never look the same.
  if (!disputes) {
    return (
      <div className="adm-state error" role="alert">
        <strong>The dispute queue could not load.</strong>
        <p style={{ marginTop: 8 }}>
          This is not the same as an empty queue — there may be disputes waiting that this page
          cannot see. Reload; if it persists, check <code>SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      </div>
    );
  }

  return <DisputeListView disputes={disputes} status={status} />;
}
