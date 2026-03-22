import Image from "next/image";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import type { UserRole } from "@/lib/types/database";

export default async function LandingNavbar() {
  const user = await getUser();
  const role = user?.user_metadata?.role as UserRole | undefined;

  return (
    <header className="absolute top-0 left-0 right-0 z-50">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/logo.svg"
            alt="StaffVA"
            width={120}
            height={44}
            priority
            className="brightness-0 invert"
          />
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href="/browse"
            className="text-sm font-medium text-white/80 hover:text-white transition-colors"
          >
            Browse Talent
          </Link>

          {user ? (
            <>
              {role === "candidate" && (
                <Link
                  href="/apply"
                  className="text-sm font-medium text-white/80 hover:text-white transition-colors"
                >
                  My Application
                </Link>
              )}
              {role === "client" && (
                <>
                  <Link
                    href="/team"
                    className="text-sm font-medium text-white/80 hover:text-white transition-colors"
                  >
                    My Team
                  </Link>
                  <Link
                    href="/inbox"
                    className="text-sm font-medium text-white/80 hover:text-white transition-colors"
                  >
                    Inbox
                  </Link>
                </>
              )}
              {role === "admin" && (
                <Link
                  href="/admin"
                  className="text-sm font-medium text-white/80 hover:text-white transition-colors"
                >
                  Admin
                </Link>
              )}
              <form action="/auth/signout" method="POST">
                <button
                  type="submit"
                  className="rounded-lg border border-white/30 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition-colors"
                >
                  Sign Out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/signup/candidate"
                className="text-sm font-medium text-white/80 hover:text-white transition-colors"
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
