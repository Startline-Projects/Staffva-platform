import Link from "next/link";
import Image from "next/image";

export default function Footer() {
  return (
    <footer className="bg-[#1C1B1A] border-t border-white/10">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          {/* Logo */}
          <div>
            <Link href="/" className="inline-block">
              <Image
                src="/logo.svg"
                alt="StaffVA"
                width={100}
                height={36}
                className="brightness-0 invert"
              />
            </Link>
            <p className="mt-3 text-sm text-gray-500 max-w-xs">
              The vetted offshore talent marketplace. Free to browse. Pay only
              when you hire.
            </p>
          </div>

          {/* For Clients */}
          <div>
            <h4 className="text-sm font-semibold text-white">For Clients</h4>
            <ul className="mt-4 space-y-2.5">
              <li>
                <Link
                  href="/browse"
                  className="text-sm text-gray-400 hover:text-primary transition-colors"
                >
                  Browse Talent
                </Link>
              </li>
              <li>
                <Link
                  href="/#how-it-works"
                  className="text-sm text-gray-400 hover:text-primary transition-colors"
                >
                  How It Works
                </Link>
              </li>
            </ul>
          </div>

          {/* For Professionals */}
          <div>
            <h4 className="text-sm font-semibold text-white">
              For Professionals
            </h4>
            <ul className="mt-4 space-y-2.5">
              <li>
                <Link
                  href="/apply"
                  className="text-sm text-gray-400 hover:text-primary transition-colors"
                >
                  Apply Now
                </Link>
              </li>
              <li>
                <Link
                  href="/#how-it-works"
                  className="text-sm text-gray-400 hover:text-primary transition-colors"
                >
                  How Vetting Works
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-sm font-semibold text-white">Company</h4>
            <ul className="mt-4 space-y-2.5">
              <li>
                <Link
                  href="/about"
                  className="text-sm text-gray-400 hover:text-primary transition-colors"
                >
                  About
                </Link>
              </li>
              <li>
                <Link
                  href="/contact"
                  className="text-sm text-gray-400 hover:text-primary transition-colors"
                >
                  Contact
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-white/10 pt-6">
          <p className="text-xs text-gray-500 text-center">
            &copy; {new Date().getFullYear()} StaffVA. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
