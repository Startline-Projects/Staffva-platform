import Image from "next/image";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import type { UserRole } from "@/lib/types/database";

export default async function Navbar() {
  const user = await getUser();
  const role = user?.user_metadata?.role as UserRole | undefined;

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-card">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.svg" alt="StaffVA" width={120} height={44} priority />
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href="/browse"
            className="text-sm font-medium text-text hover:text-primary transition-colors"
          >
            Browse Talent
          </Link>

          {user ? (
            <>
              {role === "candidate" && (
                <Link
                  href="/apply"
                  className="text-sm font-medium text-text hover:text-primary transition-colors"
                >
                  My Application
                </Link>
              )}
              {role === "client" && (
                <>
                  <Link
                    href="/team"
                    className="text-sm font-medium text-text hover:text-primary transition-colors"
                  >
                    My Team
                  </Link>
                  <Link
                    href="/inbox"
                    className="text-sm font-medium text-text hover:text-primary transition-colors"
                  >
                    Inbox
                  </Link>
                </>
              )}
              {role === "admin" && (
                <Link
                  href="/admin"
                  className="text-sm font-medium text-text hover:text-primary transition-colors"
                >
                  Admin
                </Link>
              )}
              <form action="/auth/signout" method="POST">
                <button
                  type="submit"
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-text hover:bg-gray-50 transition-colors"
                >
                  Sign Out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/signup/candidate"
                className="text-sm font-medium text-text hover:text-primary transition-colors"
              >
                Apply as a Professional
              </Link>
              <Link
                href="/login"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
              >
                Sign In
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
