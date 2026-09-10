import { loadPerformance } from "@/lib/adminPerformance";
import PerformanceView from "@/components/admin/PerformanceView";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const report = await loadPerformance();

  if (!report) {
    return (
      <div className="adm-state error" role="alert">
        <strong>Specialist performance could not be read.</strong>
        <p style={{ marginTop: 8 }}>
          Reload; if it persists, check <code>SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      </div>
    );
  }

  return <PerformanceView report={report} />;
}
