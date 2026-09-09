import { loadStaff } from "@/lib/adminStaff";
import StaffRoster from "@/components/admin/StaffRoster";

export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  const staff = await loadStaff();

  if (!staff) {
    return (
      <div className="adm-state error" role="alert">
        <strong>The staff list could not be read.</strong>
        <p style={{ marginTop: 8 }}>
          Either the <code>profiles</code> query failed or the service key is missing
          from this environment. Reload; if it persists, check{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      </div>
    );
  }

  return <StaffRoster staff={staff} />;
}
