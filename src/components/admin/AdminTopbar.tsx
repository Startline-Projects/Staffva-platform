"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface AdminTopbarProps {
  onExport?: () => void;
  onQuickApprove?: () => void;
}

// Custom events for cross-component communication
function emitDashboardModal(name: string) {
  window.dispatchEvent(new CustomEvent("adc-open-modal", { detail: name }));
}

const PAGE_NAMES: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/candidates": "Review Queue",
  "/admin/disputes": "Disputes",
  "/admin/clients": "Clients",
  "/admin/triage": "Triage Queue",
  "/admin/duplicates": "Duplicates",
  "/admin/identity": "Identity",
  "/admin/recruiters": "Talent Specialists",
  "/admin/team": "Team Inbox",
  "/admin/giveaway": "Raffle",
  "/admin/pending-bans": "Pending Bans",
  "/admin/settings": "Settings",
};

export default function AdminTopbar({ onExport, onQuickApprove }: AdminTopbarProps) {
  const pathname = usePathname();
  const [time, setTime] = useState("");

  useEffect(() => {
    function tick() {
      setTime(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const pageName = PAGE_NAMES[pathname] || "Admin";
  const isDashboard = pathname === "/admin";

  return (
    <div
      style={{
        background: "#fff",
        borderBottom: "1px solid #E8E6E1",
        padding: "0 24px",
        height: 48,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#1C1B1A" }}>Command Center</span>
        <span style={{ fontSize: 12, color: "#9C9A94", marginLeft: 6 }}>/ {pageName}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#9C9A94" }}>{time}</span>
        {isDashboard && (
          <button
            onClick={() => onExport ? onExport() : emitDashboardModal("export")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 13px",
              borderRadius: 7,
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              border: "1px solid #E2DFD8",
              background: "transparent",
              color: "#5C5A54",
              transition: "all 0.15s",
            }}
          >
            ↓ Export
          </button>
        )}
        {isDashboard && (
          <button
            onClick={() => onQuickApprove ? onQuickApprove() : emitDashboardModal("approve")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 13px",
              borderRadius: 7,
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              border: "none",
              background: "#FE6E3E",
              color: "#fff",
              transition: "all 0.15s",
            }}
          >
            + Approve Candidate
          </button>
        )}
      </div>
    </div>
  );
}
