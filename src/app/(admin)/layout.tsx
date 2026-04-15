import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminTopbar from "@/components/admin/AdminTopbar";
import { ToastProvider } from "@/components/admin/Toast";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user || (user.user_metadata?.role !== "admin" && user.user_metadata?.role !== "recruiting_manager")) {
    redirect("/login");
  }

  const isRecruitingManager = user.user_metadata?.role === "recruiting_manager";

  return (
    <>
      {/* DM Sans + DM Mono fonts */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500;600&display=swap"
        rel="stylesheet"
      />
      <ToastProvider>
        <div style={{ display: "flex", height: "100vh", minHeight: 700, fontFamily: "'DM Sans', sans-serif", fontSize: 13, background: "#F5F3EF", color: "#1C1B1A", overflow: "hidden" }}>
          <AdminSidebar isRecruitingManager={isRecruitingManager} />
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            <AdminTopbar />
            <main style={{ flex: 1, padding: "20px 24px", overflowY: "auto" }}>
              {children}
            </main>
          </div>
        </div>
      </ToastProvider>
    </>
  );
}
