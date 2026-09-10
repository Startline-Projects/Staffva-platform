import { loadAuditLog } from "@/lib/adminAudit";
import AuditLogView from "@/components/admin/AuditLogView";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const action = sp.action?.trim() || null;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const result = await loadAuditLog({ page, action });

  if (!result) {
    return (
      <div className="adm-state error" role="alert">
        <strong>The audit log could not be read.</strong>
        <p style={{ marginTop: 8 }}>
          This is not the same as an empty log. If the table is missing, the migration{" "}
          <code>admin_actions_audit</code> has not been applied to this database yet.
        </p>
      </div>
    );
  }

  return <AuditLogView page={result} action={action} />;
}
