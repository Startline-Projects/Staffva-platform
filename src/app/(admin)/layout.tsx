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
  if (!user || user.user_metadata?.role !== "admin") {
    redirect("/login");
  }

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
            <Link
              href="/admin"
              className="block rounded-lg px-3 py-2 text-sm font-medium text-text hover:bg-primary/5 hover:text-primary transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/admin/candidates"
              className="block rounded-lg px-3 py-2 text-sm font-medium text-text hover:bg-primary/5 hover:text-primary transition-colors"
            >
              Review Queue
            </Link>
            <Link
              href="/admin/disputes"
              className="block rounded-lg px-3 py-2 text-sm font-medium text-text hover:bg-primary/5 hover:text-primary transition-colors"
            >
              Disputes
            </Link>
            <Link
              href="/admin/clients"
              className="block rounded-lg px-3 py-2 text-sm font-medium text-text hover:bg-primary/5 hover:text-primary transition-colors"
            >
              Clients
            </Link>
            <Link
              href="/admin/triage"
              className="block rounded-lg px-3 py-2 text-sm font-medium text-text hover:bg-primary/5 hover:text-primary transition-colors"
            >
              Triage Queue
            </Link>
            <Link
              href="/admin/recruiters"
              className="block rounded-lg px-3 py-2 text-sm font-medium text-text hover:bg-primary/5 hover:text-primary transition-colors"
            >
              Recruiters
            </Link>
            <Link
              href="/admin/settings"
              className="block rounded-lg px-3 py-2 text-sm font-medium text-text hover:bg-primary/5 hover:text-primary transition-colors"
            >
              Settings
            </Link>
          </nav>
        </div>
      </aside>
      <main className="flex-1 bg-background p-8">{children}</main>
    </div>
    </>
  );
}
