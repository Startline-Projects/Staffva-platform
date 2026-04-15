"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Badges {
  pendingSpeakingReview: number;
  clients: number;
  talentPool: number;
  triage: number;
  teamInbox: number;
}

export default function AdminSidebar({ isRecruitingManager }: { isRecruitingManager: boolean }) {
  const pathname = usePathname();
  const [badges, setBadges] = useState<Badges>({ pendingSpeakingReview: 0, clients: 0, talentPool: 0, triage: 0, teamInbox: 0 });

  useEffect(() => {
    fetch("/api/admin/command-center")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.badges) setBadges(d.badges); })
      .catch(() => {});
  }, []);

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  };

  return (
    <aside
      style={{
        width: 200,
        minWidth: 200,
        background: "#1C1B1A",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {/* Logo */}
      <div style={{ padding: "18px 16px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 28, height: 28, background: "#FE6E3E", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: "#fff" }}>S</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", letterSpacing: -0.3 }}>StaffVA</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: 0.5, textTransform: "uppercase" as const }}>Admin Panel</div>
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ padding: "10px 0", flex: 1, overflowY: "auto" }}>
        <SectionLabel>Overview</SectionLabel>
        {!isRecruitingManager && (
          <NavItem href="/admin" active={isActive("/admin")} icon="⬡">Dashboard</NavItem>
        )}
        <NavItem href="/admin/candidates" active={isActive("/admin/candidates")} icon="◷" badge={badges.pendingSpeakingReview} badgeType="orange">Review Queue</NavItem>
        <NavItem href="/admin/disputes" active={isActive("/admin/disputes")} icon="⚑">Disputes</NavItem>

        <SectionLabel>People</SectionLabel>
        {!isRecruitingManager && (
          <NavItem href="/admin/clients" active={isActive("/admin/clients")} icon="◈" badge={badges.clients} badgeType="gray">Clients</NavItem>
        )}
        <NavItem href="/talent-pool" active={isActive("/talent-pool")} icon="◉" badge={badges.talentPool} badgeType="gray">Talent Pool</NavItem>
        <NavItem href="/admin/recruiters" active={isActive("/admin/recruiters")} icon="◎">Talent Specialists</NavItem>
        <NavItem href="/admin/triage" active={isActive("/admin/triage")} icon="⚡" badge={badges.triage} badgeType="red">Triage Queue</NavItem>
        <NavItem href="/admin/duplicates" active={isActive("/admin/duplicates")} icon="⊘">Duplicates</NavItem>

        <SectionLabel>Operations</SectionLabel>
        <NavItem href="/admin/identity" active={isActive("/admin/identity")} icon="◻">Identity</NavItem>
        <NavItem href="/admin/team" active={isActive("/admin/team")} icon="✉" badge={badges.teamInbox} badgeType="orange">Team Inbox</NavItem>
        <NavItem href="/admin/giveaway" active={isActive("/admin/giveaway")} icon="🎯">Raffle</NavItem>
        <NavItem href="/admin/pending-bans" active={isActive("/admin/pending-bans")} icon="⊗">Pending Bans</NavItem>
        <NavItem href="/admin/settings" active={isActive("/admin/settings")} icon="⚙">Settings</NavItem>
      </nav>

      {/* Logout */}
      <div style={{ padding: "12px 10px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        <form action="/auth/signout" method="POST">
          <button
            type="submit"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "7px 10px",
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: "rgba(255,255,255,0.4)",
              fontSize: 12.5,
              fontFamily: "'DM Sans', sans-serif",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(254,110,62,0.1)";
              (e.currentTarget as HTMLButtonElement).style.color = "#FE6E3E";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.4)";
            }}
          >
            <span style={{ fontSize: 13, width: 16, textAlign: "center" }}>⏻</span>
            <span>Logout</span>
          </button>
        </form>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "8px 16px 4px", fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: 1, textTransform: "uppercase" as const, fontWeight: 500 }}>
      {children}
    </div>
  );
}

function NavItem({
  href,
  active,
  icon,
  badge,
  badgeType,
  children,
}: {
  href: string;
  active: boolean;
  icon: string;
  badge?: number;
  badgeType?: "orange" | "red" | "gray";
  children: React.ReactNode;
}) {
  const badgeBg = badgeType === "red" ? "#E24B4A" : badgeType === "gray" ? "rgba(255,255,255,0.15)" : "#FE6E3E";

  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "7px 16px",
        color: active ? "#fff" : "rgba(255,255,255,0.5)",
        fontSize: 12.5,
        textDecoration: "none",
        transition: "all 0.15s",
        position: "relative",
        background: active ? "rgba(254,110,62,0.12)" : "transparent",
        borderLeft: active ? "3px solid #FE6E3E" : "3px solid transparent",
      }}
    >
      <span style={{ fontSize: 13, width: 16, textAlign: "center" }}>{icon}</span>
      <span style={{ flex: 1 }}>{children}</span>
      {badge !== undefined && badge > 0 && (
        <span
          style={{
            marginLeft: "auto",
            background: badgeBg,
            color: "#fff",
            fontSize: 9,
            fontWeight: 600,
            padding: "2px 5px",
            borderRadius: 10,
            minWidth: 16,
            textAlign: "center",
          }}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
