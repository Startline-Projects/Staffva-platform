import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import Navbar from "@/components/Navbar";

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
  const navLinkClass = "block rounded-lg px-3 py-2 text-sm font-medium text-text hover:bg-primary/5 hover:text-primary transition-colors";

  return (
    <>
    <Navbar />
    <div className="flex min-h-[calc(100vh-73px)]">
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-card">
        <div className="px-4 py-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text/40">
            Admin Panel
          </h2>
          <nav className="mt-4 space-y-1">
            {!isRecruitingManager && (
              <Link href="/admin" className={navLinkClass}>Dashboard</Link>
            )}
            <Link href="/admin/candidates" className={navLinkClass}>Review Queue</Link>
            <Link href="/admin/disputes" className={navLinkClass}>Disputes</Link>
            {!isRecruitingManager && (
              <Link href="/admin/clients" className={navLinkClass}>Clients</Link>
            )}
            <Link href="/admin/triage" className={navLinkClass}>Triage Queue</Link>
            <Link href="/admin/duplicates" className={navLinkClass}>Duplicates</Link>
            <Link href="/admin/identity" className={navLinkClass}>Identity</Link>
            <Link href="/admin/recruiters" className={navLinkClass}>Talent Specialists</Link>
            <Link href="/admin/team" className={navLinkClass}>Team Inbox</Link>
            <Link href="/admin/giveaway" className={navLinkClass}>Giveaway</Link>
            <Link href="/admin/pending-bans" className={navLinkClass}>Pending Bans</Link>
            <Link href="/talent-pool" className={navLinkClass}>Talent Pool</Link>
            <Link href="/admin/settings" className={navLinkClass}>Settings</Link>
          </nav>
        </div>
      </aside>
      <main className="flex-1 bg-background p-8">{children}</main>
    </div>
    </>
  );
}
