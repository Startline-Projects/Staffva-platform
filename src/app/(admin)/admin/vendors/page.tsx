import { loadPlatformReport } from "@/lib/adminPlatform";
import VendorHealthView from "@/components/admin/VendorHealthView";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const report = await loadPlatformReport();

  if (!report) {
    return (
      <div className="adm-state error" role="alert">
        <strong>Vendor health could not be read.</strong>
        <p style={{ marginTop: 8 }}>
          This is not the same as everything being up. Reload; if it persists, check{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      </div>
    );
  }

  return <VendorHealthView report={report} />;
}
