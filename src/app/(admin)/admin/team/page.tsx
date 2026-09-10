"use client";

import InternalChat from "@/components/recruiter/InternalChat";

/**
 * The internal team inbox.
 *
 * The chat itself is `InternalChat`, shared with the recruiter side — it
 * polls, sends and marks read, and it works. This page gives it the Atlas
 * frame and nothing else; rewriting a working 400-line chat to change its
 * paddings would be churn, and the two sides sharing one component is the
 * reason they cannot drift.
 */
export default function AdminTeamInboxPage() {
  return (
    <div className="adm-col" style={{ maxWidth: 1040, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Internal</div>
          <h1>Talking to <span className="adm-serif-italic">each other.</span></h1>
          <div className="adm-subhead">Staff-only threads — candidates and clients never see these</div>
        </div>
      </div>

      <div
        className="adm-panel"
        style={{ height: "calc(100vh - 280px)", minHeight: 420, overflow: "hidden", display: "flex" }}
      >
        <InternalChat isMobileFullScreen />
      </div>
    </div>
  );
}
