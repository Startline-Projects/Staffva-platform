import { loadEngagements } from "@/lib/adminEngagements";
import EngagementListView from "@/components/admin/EngagementListView";

export const dynamic = "force-dynamic";

export default async function EngagementsPage() {
  const rows = await loadEngagements();

  if (!rows) {
    return (
      <div className="adm-state error" role="alert">
        <strong>Engagements could not be read.</strong>
        <p style={{ marginTop: 8 }}>Reload; if it persists, check <code>SUPABASE_SERVICE_ROLE_KEY</code>.</p>
      </div>
    );
  }

  return <EngagementListView rows={rows} />;
}
