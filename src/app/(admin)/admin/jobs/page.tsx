import { loadJobs } from "@/lib/adminJobs";
import JobListView from "@/components/admin/JobListView";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const rows = await loadJobs();

  // null means the read failed. An empty array means there are no postings.
  // The list view says which, so the two never look the same.
  if (!rows) {
    return (
      <div className="adm-state error" role="alert">
        <strong>Job postings could not be read.</strong>
        <p style={{ marginTop: 8 }}>Reload; if it persists, check <code>SUPABASE_SERVICE_ROLE_KEY</code>.</p>
      </div>
    );
  }

  return <JobListView rows={rows} />;
}
