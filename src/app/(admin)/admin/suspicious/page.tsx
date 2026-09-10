import { loadSafetyReport } from "@/lib/adminSafety";
import SuspiciousActivityView from "@/components/admin/SuspiciousActivityView";

export const dynamic = "force-dynamic";

export default async function SuspiciousActivityPage() {
  const report = await loadSafetyReport();

  if (!report) {
    return (
      <div className="adm-state error" role="alert">
        <strong>The integrity signals could not be read.</strong>
        <p style={{ marginTop: 8 }}>
          This is not the same as a clean platform. Reload; if it persists, check{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      </div>
    );
  }

  return <SuspiciousActivityView report={report} />;
}
