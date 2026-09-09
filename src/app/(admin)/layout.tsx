import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import AdminFrame from "@/components/admin/AdminFrame";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  const role = user?.app_metadata?.role;
  if (!user || (role !== "admin" && role !== "recruiting_manager")) {
    redirect("/login");
  }

  const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string };

  return (
    <AdminFrame
      isRecruitingManager={role === "recruiting_manager"}
      userName={meta.full_name || meta.name || user.email || "Staff"}
      userEmail={user.email || ""}
    >
      {children}
    </AdminFrame>
  );
}
