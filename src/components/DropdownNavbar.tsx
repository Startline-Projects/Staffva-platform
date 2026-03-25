"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";

interface DropdownNavbarProps {
  user: { role?: string } | null;
  variant?: "light" | "dark";
}

type DropdownKey = "hire-staff" | "hire-freelancer" | "for-professionals" | null;

const HIRE_STAFF_ROLES = [
  { label: "Paralegal", href: "/browse?role=Paralegal" },
  { label: "Legal Assistant", href: "/browse?role=Legal+Assistant" },
  { label: "Bookkeeper", href: "/browse?role=Bookkeeping" },
  { label: "Accounts Payable Specialist", href: "/browse?role=Accounts+Payable" },
  { label: "Admin Assistant", href: "/browse?role=Admin" },
  { label: "Virtual Assistant", href: "/browse?role=VA" },
  { label: "Scheduling Coordinator", href: "/browse?role=Scheduling" },
  { label: "Medical Billing Specialist", href: "/browse?role=Medical+Billing" },
  { label: "Executive Assistant", href: "/browse?role=Executive+Assistant" },
  { label: "Customer Support", href: "/browse?role=Customer+Support" },
];

const HIRE_FREELANCER_SERVICES = [
  { label: "Contract Review", href: "/services?category=Contract+Review" },
  { label: "Document Drafting", href: "/services?category=Document+Drafting" },
  { label: "Books Reconciliation", href: "/services?category=Books+Reconciliation" },
  { label: "Invoice Processing", href: "/services?category=Invoice+Processing" },
  { label: "Administrative Support", href: "/services?category=Administrative+Support" },
  { label: "Research and Reports", href: "/services?category=Research+and+Reports" },
];

export default function DropdownNavbar({ user, variant = "light" }: DropdownNavbarProps) {
  const [activeDropdown, setActiveDropdown] = useState<DropdownKey>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileAccordion, setMobileAccordion] = useState<DropdownKey>(null);
  const navRef = useRef<HTMLElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const role = user?.role;
  const isLoggedIn = !!user;
  const isDark = variant === "dark";

  const textColor = isDark ? "text-white/80 hover:text-white" : "text-[#1C1B1A] hover:text-primary";
  const bgColor = isDark ? "bg-transparent" : "bg-white";
  const logoClass = isDark ? "brightness-0 invert" : "";

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setActiveDropdown(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setActiveDropdown(null);
        setMobileOpen(false);
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const handleMouseEnter = useCallback((key: DropdownKey) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setActiveDropdown(key);
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setActiveDropdown(null);
    }, 150);
  }, []);

  function toggleMobileAccordion(key: DropdownKey) {
    setMobileAccordion(mobileAccordion === key ? null : key);
  }

  return (
    <header ref={navRef} className={`${isDark ? "absolute top-0 left-0 right-0" : "sticky top-0"} z-50 ${bgColor}`}>
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 h-14">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <Image src="/logo.svg" alt="StaffVA" width={110} height={40} priority className={logoClass} />
        </Link>

        {/* Desktop nav — centered */}
        <div className="hidden lg:flex items-center gap-0.5 absolute left-1/2 -translate-x-1/2">
          {/* Hire Staff */}
          <div
            className="relative"
            onMouseEnter={() => handleMouseEnter("hire-staff")}
            onMouseLeave={handleMouseLeave}
          >
            <button className={`flex items-center gap-1 px-3.5 py-1.5 text-[14px] font-medium transition-colors ${textColor}`}>
              Hire Staff
              <svg className={`w-3.5 h-3.5 transition-transform ${activeDropdown === "hire-staff" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <div className={`absolute left-1/2 -translate-x-1/2 top-full pt-2 transition-all duration-150 ${activeDropdown === "hire-staff" ? "opacity-100 visible translate-y-0" : "opacity-0 invisible -translate-y-2"}`}>
              <div className="w-[640px] rounded-xl bg-white shadow-lg border border-[#E0E0E0] overflow-hidden">
                <div className="grid grid-cols-2 p-6 gap-8">
                  {/* By Role */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-text/40 mb-3">By Role</p>
                    <div className="space-y-0.5">
                      {HIRE_STAFF_ROLES.map((item) => (
                        <Link
                          key={item.label}
                          href={item.href}
                          onClick={() => setActiveDropdown(null)}
                          className="block rounded-lg px-3 py-2 text-sm text-text/80 hover:bg-primary/5 hover:text-primary transition-colors"
                        >
                          {item.label}
                        </Link>
                      ))}
                      <Link
                        href="/browse"
                        onClick={() => setActiveDropdown(null)}
                        className="block px-3 py-2 text-sm font-semibold text-primary hover:text-orange-600 transition-colors"
                      >
                        View all professionals &rarr;
                      </Link>
                    </div>
                  </div>

                  {/* By Availability */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-text/40 mb-3">By Availability</p>
                    <div className="space-y-1">
                      <Link
                        href="/browse?availability=available"
                        onClick={() => setActiveDropdown(null)}
                        className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-primary/5 transition-colors"
                      >
                        <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                        <div>
                          <p className="text-sm font-medium text-text">Available Now</p>
                          <p className="text-xs text-text/50">Ready to start immediately</p>
                        </div>
                      </Link>
                      <Link
                        href="/browse?availability=partial"
                        onClick={() => setActiveDropdown(null)}
                        className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-primary/5 transition-colors"
                      >
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                        <div>
                          <p className="text-sm font-medium text-text">Partially Available</p>
                          <p className="text-xs text-text/50">Some hours remaining</p>
                        </div>
                      </Link>
                      <Link
                        href="/browse"
                        onClick={() => setActiveDropdown(null)}
                        className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-primary/5 transition-colors"
                      >
                        <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                        <div>
                          <p className="text-sm font-medium text-text">All Professionals</p>
                          <p className="text-xs text-text/50">Browse everyone</p>
                        </div>
                      </Link>
                    </div>
                  </div>
                </div>

                {/* Bottom banner */}
                <div className="bg-[#1C1B1A] px-6 py-4 flex items-center justify-between">
                  <p className="text-xs text-white/60">
                    Every professional passed a human English and speaking assessment.
                  </p>
                  <Link
                    href="/browse"
                    onClick={() => setActiveDropdown(null)}
                    className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-orange-600 transition-colors flex-shrink-0"
                  >
                    Browse All Professionals
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Hire Freelancer */}
          <div
            className="relative"
            onMouseEnter={() => handleMouseEnter("hire-freelancer")}
            onMouseLeave={handleMouseLeave}
          >
            <button className={`flex items-center gap-1 px-3.5 py-1.5 text-[14px] font-medium transition-colors ${textColor}`}>
              Hire Freelancer
              <svg className={`w-3.5 h-3.5 transition-transform ${activeDropdown === "hire-freelancer" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <div className={`absolute left-1/2 -translate-x-1/2 top-full pt-2 transition-all duration-150 ${activeDropdown === "hire-freelancer" ? "opacity-100 visible translate-y-0" : "opacity-0 invisible -translate-y-2"}`}>
              <div className="w-[560px] rounded-xl bg-white shadow-lg border border-[#E0E0E0] overflow-hidden">
                <div className="grid grid-cols-2 p-6 gap-8">
                  {/* By Service */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-text/40 mb-3">By Service</p>
                    <div className="space-y-0.5">
                      {HIRE_FREELANCER_SERVICES.map((item) => (
                        <Link
                          key={item.label}
                          href={item.href}
                          onClick={() => setActiveDropdown(null)}
                          className="block rounded-lg px-3 py-2 text-sm text-text/80 hover:bg-primary/5 hover:text-primary transition-colors"
                        >
                          {item.label}
                        </Link>
                      ))}
                      <Link
                        href="/services"
                        onClick={() => setActiveDropdown(null)}
                        className="block px-3 py-2 text-sm font-semibold text-primary hover:text-orange-600 transition-colors"
                      >
                        View all services &rarr;
                      </Link>
                    </div>
                  </div>

                  {/* By Delivery Time */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-text/40 mb-3">By Delivery Time</p>
                    <div className="space-y-1">
                      <Link
                        href="/services?delivery=1"
                        onClick={() => setActiveDropdown(null)}
                        className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-primary/5 transition-colors"
                      >
                        <svg className="w-5 h-5 text-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <div>
                          <p className="text-sm font-medium text-text">Delivered in 24 hours</p>
                          <p className="text-xs text-text/50">Urgent turnaround</p>
                        </div>
                      </Link>
                      <Link
                        href="/services?delivery=3"
                        onClick={() => setActiveDropdown(null)}
                        className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-primary/5 transition-colors"
                      >
                        <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <p className="text-sm font-medium text-text">Delivered in 3 days</p>
                          <p className="text-xs text-text/50">Standard turnaround</p>
                        </div>
                      </Link>
                      <Link
                        href="/services?delivery=7"
                        onClick={() => setActiveDropdown(null)}
                        className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-primary/5 transition-colors"
                      >
                        <svg className="w-5 h-5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <div>
                          <p className="text-sm font-medium text-text">Delivered in 7 days</p>
                          <p className="text-xs text-text/50">Complex projects</p>
                        </div>
                      </Link>
                    </div>
                  </div>
                </div>

                {/* Bottom banner */}
                <div className="bg-[#1C1B1A] px-6 py-4 flex items-center justify-between">
                  <p className="text-xs text-white/60">
                    Browse pre-packaged services from vetted professionals.
                  </p>
                  <Link
                    href="/services"
                    onClick={() => setActiveDropdown(null)}
                    className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-orange-600 transition-colors flex-shrink-0"
                  >
                    Browse All Services
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* For Professionals */}
          <div
            className="relative"
            onMouseEnter={() => handleMouseEnter("for-professionals")}
            onMouseLeave={handleMouseLeave}
          >
            <button className={`flex items-center gap-1 px-3.5 py-1.5 text-[14px] font-medium transition-colors ${textColor}`}>
              For Professionals
              <svg className={`w-3.5 h-3.5 transition-transform ${activeDropdown === "for-professionals" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <div className={`absolute left-1/2 -translate-x-1/2 top-full pt-2 transition-all duration-150 ${activeDropdown === "for-professionals" ? "opacity-100 visible translate-y-0" : "opacity-0 invisible -translate-y-2"}`}>
              <div className="w-[280px] rounded-xl bg-white shadow-lg border border-[#E0E0E0] overflow-hidden p-4 space-y-1">
                <Link
                  href="/apply"
                  onClick={() => setActiveDropdown(null)}
                  className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-primary/5 transition-colors"
                >
                  <svg className="w-5 h-5 text-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-text">Apply as a Professional</p>
                    <p className="text-xs text-text/50">Join our vetted talent pool</p>
                  </div>
                </Link>
                <Link
                  href="/login"
                  onClick={() => setActiveDropdown(null)}
                  className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-primary/5 transition-colors"
                >
                  <svg className="w-5 h-5 text-text/40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-text">Sign in to my account</p>
                    <p className="text-xs text-text/50">Manage your profile</p>
                  </div>
                </Link>
              </div>
            </div>
          </div>

          {/* Tech Team link */}
          <a
            href="https://startline.build"
            target="_blank"
            rel="noopener noreferrer"
            className="group px-3.5 py-1.5 text-[14px] font-medium text-[#1C1B1A] hover:text-[#FE6E3E] transition-colors"
          >
            <span className="group-hover:hidden">Tech Team</span>
            <span className="hidden group-hover:inline-flex items-center gap-1">
              Tech Team: Startline
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </span>
          </a>
        </div>

        {/* Right side — auth buttons or logged-in nav */}
        <div className="hidden lg:flex items-center gap-3">
          {isLoggedIn ? (
            <>
              {role === "candidate" && (
                <>
                  <Link href="/candidate/dashboard" className={`text-[14px] font-medium transition-colors ${textColor}`}>Dashboard</Link>
                  <Link href="/candidate/me" className={`text-[14px] font-medium transition-colors ${textColor}`}>My Profile</Link>
                  <Link href="/services" className={`text-[14px] font-medium transition-colors ${textColor}`}>My Services</Link>
                </>
              )}
              {role === "client" && (
                <>
                  <Link href="/team" className={`text-[14px] font-medium transition-colors ${textColor}`}>My Team</Link>
                  <Link href="/inbox" className={`text-[14px] font-medium transition-colors ${textColor}`}>Inbox</Link>
                  <Link href="/services" className={`text-[14px] font-medium transition-colors ${textColor}`}>Purchases</Link>
                </>
              )}
              {role === "recruiter" && (
                <Link href="/recruiter" className={`text-[14px] font-medium transition-colors ${textColor}`}>Recruiter</Link>
              )}
              {role === "admin" && (
                <>
                  <Link href="/admin" className={`text-[14px] font-medium transition-colors ${textColor}`}>Admin</Link>
                  <Link href="/recruiter" className={`text-[14px] font-medium transition-colors ${textColor}`}>Recruiter</Link>
                </>
              )}
              {(role === "recruiter" || role === "admin") && (
                <Link
                  href="/account/change-password"
                  className={`text-[14px] font-medium transition-colors ${
                    isDark
                      ? "text-white/70 hover:text-white"
                      : "text-[#1C1B1A] hover:text-primary"
                  }`}
                >
                  Account
                </Link>
              )}
              <form action="/auth/signout" method="POST">
                <button
                  type="submit"
                  className={`text-[14px] font-medium transition-colors ${
                    isDark
                      ? "text-white/70 hover:text-white"
                      : "text-[#1C1B1A] hover:text-primary"
                  }`}
                >
                  Sign Out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-[14px] font-medium text-[#1C1B1A] hover:text-primary transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/signup/client"
                className="rounded-lg bg-primary px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#E55A2B] transition-colors"
              >
                Get Started
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className={`lg:hidden p-2 rounded-lg transition-colors ${isDark ? "text-white hover:bg-white/10" : "text-text hover:bg-gray-100"}`}
        >
          {mobileOpen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className={`lg:hidden border-t ${isDark ? "bg-[#1C1B1A] border-white/10" : "bg-white border-gray-200"} max-h-[80vh] overflow-y-auto`}>
          <div className="px-6 py-4 space-y-1">

            {/* Hire Staff accordion */}
            <div>
              <button
                onClick={() => toggleMobileAccordion("hire-staff")}
                className={`flex w-full items-center justify-between py-3 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}
              >
                Hire Staff
                <svg className={`w-4 h-4 transition-transform ${mobileAccordion === "hire-staff" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {mobileAccordion === "hire-staff" && (
                <div className="pb-3 pl-4 space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text/40 mb-2">By Role</p>
                  {HIRE_STAFF_ROLES.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`block py-1.5 text-sm ${isDark ? "text-white/70 hover:text-white" : "text-text/70 hover:text-primary"}`}
                    >
                      {item.label}
                    </Link>
                  ))}
                  <Link href="/browse" onClick={() => setMobileOpen(false)} className="block py-1.5 text-sm font-semibold text-primary">
                    View all &rarr;
                  </Link>
                </div>
              )}
            </div>

            {/* Hire Freelancer accordion */}
            <div>
              <button
                onClick={() => toggleMobileAccordion("hire-freelancer")}
                className={`flex w-full items-center justify-between py-3 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}
              >
                Hire Freelancer
                <svg className={`w-4 h-4 transition-transform ${mobileAccordion === "hire-freelancer" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {mobileAccordion === "hire-freelancer" && (
                <div className="pb-3 pl-4 space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text/40 mb-2">By Service</p>
                  {HIRE_FREELANCER_SERVICES.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`block py-1.5 text-sm ${isDark ? "text-white/70 hover:text-white" : "text-text/70 hover:text-primary"}`}
                    >
                      {item.label}
                    </Link>
                  ))}
                  <Link href="/services" onClick={() => setMobileOpen(false)} className="block py-1.5 text-sm font-semibold text-primary">
                    View all services &rarr;
                  </Link>
                </div>
              )}
            </div>

            {/* For Professionals accordion */}
            <div>
              <button
                onClick={() => toggleMobileAccordion("for-professionals")}
                className={`flex w-full items-center justify-between py-3 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}
              >
                For Professionals
                <svg className={`w-4 h-4 transition-transform ${mobileAccordion === "for-professionals" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {mobileAccordion === "for-professionals" && (
                <div className="pb-3 pl-4 space-y-1">
                  <Link href="/apply" onClick={() => setMobileOpen(false)} className={`block py-1.5 text-sm ${isDark ? "text-white/70 hover:text-white" : "text-text/70 hover:text-primary"}`}>
                    Apply as a Professional
                  </Link>
                  <Link href="/login" onClick={() => setMobileOpen(false)} className={`block py-1.5 text-sm ${isDark ? "text-white/70 hover:text-white" : "text-text/70 hover:text-primary"}`}>
                    Sign in to my account
                  </Link>
                </div>
              )}
            </div>

            {/* Tech Team link */}
            <a
              href="https://startline.build"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMobileOpen(false)}
              className={`flex items-center justify-between py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}
            >
              <span>Tech Team: Startline</span>
              <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>

            {/* Divider */}
            <div className={`border-t ${isDark ? "border-white/10" : "border-gray-200"} my-2`} />

            {/* Auth / role links */}
            {isLoggedIn ? (
              <div className="space-y-1">
                {role === "candidate" && (
                  <>
                    <Link href="/apply" onClick={() => setMobileOpen(false)} className={`block py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}>My Application</Link>
                    <Link href="/candidate/me" onClick={() => setMobileOpen(false)} className={`block py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}>My Profile</Link>
                    <Link href="/services" onClick={() => setMobileOpen(false)} className={`block py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}>My Services</Link>
                  </>
                )}
                {role === "client" && (
                  <>
                    <Link href="/team" onClick={() => setMobileOpen(false)} className={`block py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}>My Team</Link>
                    <Link href="/inbox" onClick={() => setMobileOpen(false)} className={`block py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}>Inbox</Link>
                    <Link href="/services" onClick={() => setMobileOpen(false)} className={`block py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}>My Purchases</Link>
                  </>
                )}
                {role === "admin" && (
                  <Link href="/admin" onClick={() => setMobileOpen(false)} className={`block py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}>Admin</Link>
                )}
                <form action="/auth/signout" method="POST" className="pt-2">
                  <button type="submit" className="w-full rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-text hover:bg-gray-50">
                    Sign Out
                  </button>
                </form>
              </div>
            ) : (
              <div className="space-y-2 pt-2">
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className="block w-full rounded-lg border border-primary py-2.5 text-center text-sm font-semibold text-primary hover:bg-primary/5"
                >
                  Sign In
                </Link>
                <Link
                  href="/signup/client"
                  onClick={() => setMobileOpen(false)}
                  className="block w-full rounded-lg bg-primary py-2.5 text-center text-sm font-semibold text-white hover:bg-orange-600"
                >
                  Get Started
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
