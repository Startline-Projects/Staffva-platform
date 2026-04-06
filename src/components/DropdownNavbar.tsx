"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import NotificationBell from "@/components/NotificationBell";

interface DropdownNavbarProps {
  user: { role?: string } | null;
  variant?: "light" | "dark";
}

type DropdownKey = "build-team" | "for-professionals" | null;

const BUILD_TEAM_NEEDS = [
  { label: "Legal and compliance work", href: "/browse?role=Paralegal" },
  { label: "Books and finances", href: "/browse?role=Bookkeeping" },
  { label: "Operations and admin", href: "/browse?role=Admin" },
  { label: "Customer and client relations", href: "/browse?role=Customer+Support" },
  { label: "Content and creative work", href: "/browse?role=Content+Writer" },
  { label: "Technical and development", href: "/browse?role=Project+Manager" },
  { label: "Healthcare and medical admin", href: "/browse?role=Medical+Billing" },
  { label: "Executive and business support", href: "/browse?role=Executive+Assistant" },
];

const BUILD_TEAM_AVAILABILITY = [
  { label: "Full time — 35+ hours/week", href: "/browse?availability=available", desc: "Dedicated professional" },
  { label: "Part time — 15-35 hours/week", href: "/browse?availability=partially_available", desc: "Flexible commitment" },
  { label: "Flexible — under 15 hours/week", href: "/browse", desc: "As-needed support" },
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
  const [showSignupModal, setShowSignupModal] = useState(false);

  const textColor = isDark ? "text-white/80 hover:text-white" : "text-[#1C1B1A] hover:text-primary";
  const bgColor = isDark ? "bg-transparent" : "bg-white";
  const logoClass = isDark ? "brightness-0 invert" : "";

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setActiveDropdown(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") { setActiveDropdown(null); setMobileOpen(false); }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const handleMouseEnter = useCallback((key: DropdownKey) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setActiveDropdown(key);
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => setActiveDropdown(null), 150);
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
          {/* Hire Staff — hidden from candidates */}
          {role !== "candidate" && (
            <div className="relative" onMouseEnter={() => handleMouseEnter("build-team")} onMouseLeave={handleMouseLeave}>
              <button className={`flex items-center gap-1 px-3.5 py-1.5 text-[14px] font-medium transition-colors ${textColor}`}>
                Hire Staff
                <svg className={`w-3.5 h-3.5 transition-transform ${activeDropdown === "build-team" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <div className={`absolute left-1/2 -translate-x-1/2 top-full pt-2 transition-all duration-150 ${activeDropdown === "build-team" ? "opacity-100 visible translate-y-0" : "opacity-0 invisible -translate-y-2"}`}>
                <div className="w-[640px] rounded-xl bg-white shadow-lg border border-[#E0E0E0] overflow-hidden">
                  <div className="grid grid-cols-2 p-6 gap-8">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-text/40 mb-3">What do you need help with?</p>
                      <div className="space-y-0.5">
                        {BUILD_TEAM_NEEDS.map((item) => (
                          <Link key={item.label} href={item.href} onClick={() => setActiveDropdown(null)} className="block rounded-lg px-3 py-2 text-sm text-text/80 hover:bg-primary/5 hover:text-primary transition-colors">
                            {item.label}
                          </Link>
                        ))}
                        <Link href="/browse" onClick={() => setActiveDropdown(null)} className="block px-3 py-2 text-sm font-semibold text-primary hover:text-orange-600 transition-colors">
                          View all professionals &rarr;
                        </Link>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-text/40 mb-3">How available do you need them?</p>
                      <div className="space-y-1">
                        {BUILD_TEAM_AVAILABILITY.map((item) => (
                          <Link key={item.label} href={item.href} onClick={() => setActiveDropdown(null)} className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-primary/5 transition-colors">
                            <div>
                              <p className="text-sm font-medium text-text">{item.label}</p>
                              <p className="text-xs text-text/50">{item.desc}</p>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="bg-[#1C1B1A] px-6 py-4 flex items-center justify-between">
                    <p className="text-xs text-white/60">Every professional passed a live English and speaking assessment.</p>
                    <Link href="/browse" onClick={() => setActiveDropdown(null)} className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-orange-600 transition-colors flex-shrink-0">
                      Browse All Professionals
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* For Professionals — visible to logged-out visitors only */}
          {!isLoggedIn && (
            <div className="relative" onMouseEnter={() => handleMouseEnter("for-professionals")} onMouseLeave={handleMouseLeave}>
              <button className={`flex items-center gap-1 px-3.5 py-1.5 text-[14px] font-medium transition-colors ${textColor}`}>
                For Professionals
                <svg className={`w-3.5 h-3.5 transition-transform ${activeDropdown === "for-professionals" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <div className={`absolute left-1/2 -translate-x-1/2 top-full pt-2 transition-all duration-150 ${activeDropdown === "for-professionals" ? "opacity-100 visible translate-y-0" : "opacity-0 invisible -translate-y-2"}`}>
                <div className="w-[280px] rounded-xl bg-white shadow-lg border border-[#E0E0E0] overflow-hidden p-4 space-y-1">
                  <Link href="/apply" onClick={() => setActiveDropdown(null)} className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-primary/5 transition-colors">
                    <svg className="w-5 h-5 text-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-text">Apply as a Professional</p>
                      <p className="text-xs text-text/50">Join our vetted talent pool</p>
                    </div>
                  </Link>
                  <Link href="/login" onClick={() => setActiveDropdown(null)} className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-primary/5 transition-colors">
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
          )}
        </div>

        {/* Right side — auth buttons or logged-in nav */}
        <div className="hidden lg:flex items-center gap-3">
          {isLoggedIn ? (
            <>
              {role === "candidate" && (
                <>
                  <Link href="/candidate/dashboard" className={`text-[14px] font-medium transition-colors ${textColor}`}>Dashboard</Link>
                  <Link href="/candidate/me" className={`text-[14px] font-medium transition-colors ${textColor}`}>My Profile</Link>
                  <Link href="/apply" className={`text-[14px] font-medium transition-colors ${textColor}`}>Application</Link>
                  <NotificationBell />
                </>
              )}
              {role === "client" && (
                <>
                  <Link href="/team" className={`text-[14px] font-medium transition-colors ${textColor}`}>My Team</Link>
                  <Link href="/inbox" className={`text-[14px] font-medium transition-colors ${textColor}`}>Inbox</Link>
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
              <form action="/auth/signout" method="POST">
                <button type="submit" className={`text-[14px] font-medium transition-colors ${isDark ? "text-white/70 hover:text-white" : "text-[#1C1B1A] hover:text-primary"}`}>
                  Sign Out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-[14px] font-medium text-[#1C1B1A] hover:text-primary transition-colors">
                Sign In
              </Link>
              <button onClick={() => setShowSignupModal(true)} className="rounded-lg bg-primary px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#E55A2B] transition-colors">
                Get Started
              </button>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className={`lg:hidden p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors ${isDark ? "text-white hover:bg-white/10" : "text-text hover:bg-gray-100"}`}
        >
          {mobileOpen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
          )}
        </button>
      </nav>

      {/* ═══ MOBILE MENU ═══ */}
      {mobileOpen && (
        <div className={`lg:hidden border-t ${isDark ? "bg-[#1C1B1A] border-white/10" : "bg-white border-gray-200"} max-h-[80vh] overflow-y-auto`}>
          <div className="px-6 py-4 space-y-3">

            {/* Hire Staff card */}
            <div className="rounded-xl bg-[#1C1B1A] overflow-hidden">
              <button onClick={() => toggleMobileAccordion("build-team")} className="flex w-full items-center justify-between p-4">
                <span className="text-sm font-semibold text-white">Hire Staff</span>
                <svg className={`w-4 h-4 text-white/60 transition-transform ${mobileAccordion === "build-team" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {mobileAccordion === "build-team" && (
                <div className="px-4 pb-4 space-y-1">
                  {BUILD_TEAM_NEEDS.map((item) => (
                    <Link key={item.label} href={item.href} onClick={() => setMobileOpen(false)} className="block py-2 text-sm text-white/70 hover:text-white">
                      {item.label}
                    </Link>
                  ))}
                  <Link href="/browse" onClick={() => setMobileOpen(false)} className="block py-2 text-sm font-semibold text-primary">
                    View all &rarr;
                  </Link>
                </div>
              )}
            </div>

            {/* For Professionals */}
            <Link href="/apply" onClick={() => setMobileOpen(false)} className={`block py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}>
              For Professionals
            </Link>

            {/* Divider */}
            <div className={`border-t ${isDark ? "border-white/10" : "border-gray-200"}`} />

            {/* Auth / role links */}
            {isLoggedIn ? (
              <div className="space-y-1">
                {role === "candidate" && (
                  <>
                    <Link href="/candidate/dashboard" onClick={() => setMobileOpen(false)} className={`block py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}>Dashboard</Link>
                    <Link href="/candidate/me" onClick={() => setMobileOpen(false)} className={`block py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}>My Profile</Link>
                    <Link href="/apply" onClick={() => setMobileOpen(false)} className={`block py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}>Application</Link>
                  </>
                )}
                {role === "client" && (
                  <>
                    <Link href="/team" onClick={() => setMobileOpen(false)} className={`block py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}>My Team</Link>
                    <Link href="/inbox" onClick={() => setMobileOpen(false)} className={`block py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}>Inbox</Link>
                  </>
                )}
                {role === "admin" && (
                  <Link href="/admin" onClick={() => setMobileOpen(false)} className={`block py-2 text-sm font-medium ${isDark ? "text-white" : "text-text"}`}>Admin</Link>
                )}
                <form action="/auth/signout" method="POST" className="pt-2">
                  <button type="submit" className="w-full rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-text hover:bg-gray-50">Sign Out</button>
                </form>
              </div>
            ) : (
              <div className="space-y-2 pt-2">
                <Link href="/login" onClick={() => setMobileOpen(false)} className="block py-2 text-sm font-medium text-text">Sign In</Link>
                <button onClick={() => { setMobileOpen(false); setShowSignupModal(true); }} className="block w-full rounded-lg bg-primary py-2.5 text-center text-sm font-semibold text-white hover:bg-orange-600">
                  Get Started
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* ═══ SIGNUP MODAL ═══ */}
      {showSignupModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowSignupModal(false)}>
          <div className="relative mx-4 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Close button */}
            <button
              onClick={() => setShowSignupModal(false)}
              className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h2 className="text-xl font-bold text-[#1C1B1A] text-center mb-6">How will you use StaffVA?</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Employer card */}
              <Link
                href="/signup/client"
                onClick={() => setShowSignupModal(false)}
                className="group rounded-xl border-2 border-gray-200 p-6 text-center hover:border-primary transition-colors"
              >
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                  <svg className="h-7 w-7 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-[#1C1B1A]">Sign up as an Employer</h3>
                <p className="mt-1 text-xs text-gray-500">Post roles and hire pre-vetted professionals</p>
              </Link>

              {/* Professional card */}
              <Link
                href="/signup/candidate"
                onClick={() => setShowSignupModal(false)}
                className="group rounded-xl border-2 border-gray-200 p-6 text-center hover:border-[#1C1B1A] transition-colors"
              >
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
                  <svg className="h-7 w-7 text-[#1C1B1A]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-[#1C1B1A]">Apply as a Professional</h3>
                <p className="mt-1 text-xs text-gray-500">Build your profile and get hired by US businesses</p>
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
