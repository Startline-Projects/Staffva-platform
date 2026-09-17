import { findDimension, loadReport } from "@/lib/adminReports";
import ReportView from "@/components/admin/ReportView";
import { loadScreeningHealth } from "@/lib/adminScreening";
import ScreeningHealthPanel from "@/components/admin/ScreeningHealthPanel";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const dimension = findDimension(sp.d);
  const from = sp.from && ISO_DATE.test(sp.from) ? sp.from : null;
  const to = sp.to && ISO_DATE.test(sp.to) ? sp.to : null;

  const report = await loadReport(dimension, from, to);

  // The screening breakdown is the one dimension where the distribution is
  // mostly an artefact rather than a finding, and it is where the dashboard
  // alert sends people. It gets the explanation and the re-run beside it.
  const health = dimension.id === "cand_screening" ? await loadScreeningHealth() : null;

  if (!report) {
    return (
      <div className="adm-state error" role="alert">
        <strong>That report could not be run.</strong>
        <p style={{ marginTop: 8 }}>
          The query failed — this is not the same as a report with no rows. Reload; if it persists,
          check <code>SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      {health && <ScreeningHealthPanel health={health} />}
      <ReportView report={report} />
    </>
  );
}
