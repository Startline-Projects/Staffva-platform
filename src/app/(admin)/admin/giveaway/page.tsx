"use client";

import { useState, useEffect } from "react";

interface GiveawayEntry {
  id: string;
  candidate_id: string;
  application_complete: boolean;
  profile_approved: boolean;
  tag_verified: boolean;
  eligible: boolean;
  tag_verified_at: string | null;
  candidates: {
    id: string;
    display_name: string;
    full_name: string;
    email: string;
    country: string;
    role_category: string;
    profile_photo_url: string | null;
    admin_status: string;
  };
}

interface WinnerLog {
  id: string;
  winner_1_candidate_id: string;
  winner_2_candidate_id: string;
  selected_at: string;
  selection_method: string;
}

export default function AdminGiveawayPage() {
  const [entries, setEntries] = useState<GiveawayEntry[]>([]);
  const [eligibleCount, setEligibleCount] = useState(0);
  const [totalEntries, setTotalEntries] = useState(0);
  const [pastWinners, setPastWinners] = useState<WinnerLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedWinners, setSelectedWinners] = useState<{ id: string; display_name: string; email: string }[] | null>(null);
  const [filter, setFilter] = useState<"all" | "eligible" | "pending">("all");

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/giveaway");
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        setEligibleCount(data.eligibleCount || 0);
        setTotalEntries(data.totalEntries || 0);
        setPastWinners(data.pastWinners || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }

  async function toggleTag(entryId: string) {
    setToggling(entryId);
    await fetch("/api/admin/giveaway", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle_tag", entryId }),
    });
    await loadData();
    setToggling(null);
  }

  async function selectWinners() {
    if (!confirm("Select 2 random winners from the eligible pool? This action is logged and auditable.")) return;
    setSelecting(true);
    try {
      const res = await fetch("/api/admin/giveaway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "select_winners" }),
      });
      const data = await res.json();
      if (data.winners) setSelectedWinners(data.winners);
      await loadData();
    } catch { /* silent */ }
    setSelecting(false);
  }

  const filtered = entries.filter((e) => {
    if (filter === "eligible") return e.eligible;
    if (filter === "pending") return !e.eligible;
    return true;
  });

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1B1A]">Giveaway Management</h1>
          <p className="mt-1 text-sm text-gray-500">$3,000 launch giveaway — tag verification and winner selection</p>
        </div>
        <button
          onClick={selectWinners}
          disabled={selecting || eligibleCount < 2}
          className="rounded-lg bg-[#FE6E3E] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B] disabled:opacity-50 transition-colors"
        >
          {selecting ? "Selecting..." : "Select 2 Winners"}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-[#1C1B1A]">{totalEntries}</p>
          <p className="text-xs text-gray-500 mt-1">Total Entries</p>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{eligibleCount}</p>
          <p className="text-xs text-green-600 mt-1">Fully Eligible</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-[#FE6E3E]">{totalEntries - eligibleCount}</p>
          <p className="text-xs text-gray-500 mt-1">Pending Steps</p>
        </div>
      </div>

      {/* Winner announcement */}
      {selectedWinners && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-5">
          <h3 className="text-sm font-semibold text-green-800 mb-2">Winners Selected!</h3>
          {selectedWinners.map((w) => (
            <p key={w.id} className="text-sm text-green-700">
              {w.display_name} — {w.email}
            </p>
          ))}
          <button onClick={() => setSelectedWinners(null)} className="mt-2 text-xs text-green-600 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {(["all", "eligible", "pending"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              filter === f ? "bg-[#FE6E3E] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {f === "all" ? "All" : f === "eligible" ? "Eligible" : "Pending"}
          </button>
        ))}
      </div>

      {/* Entries table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/50">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-500">Candidate</th>
              <th className="px-4 py-3 font-medium text-gray-500">Application</th>
              <th className="px-4 py-3 font-medium text-gray-500">Profile</th>
              <th className="px-4 py-3 font-medium text-gray-500">Tag Verified</th>
              <th className="px-4 py-3 font-medium text-gray-500">Eligible</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((e) => {
              const c = e.candidates as GiveawayEntry["candidates"];
              return (
                <tr key={e.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gray-100">
                        {c?.profile_photo_url ? (
                          <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-gray-400">
                            {c?.display_name?.[0] || "?"}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-[#1C1B1A] text-xs">{c?.display_name || c?.full_name}</p>
                        <p className="text-[10px] text-gray-400">{c?.country} · {c?.role_category}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${e.application_complete ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {e.application_complete ? "Complete" : "Pending"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${e.profile_approved ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {e.profile_approved ? "Approved" : "Pending"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleTag(e.id)}
                      disabled={toggling === e.id}
                      className={`rounded-full px-3 py-1 text-[10px] font-medium transition-colors ${
                        e.tag_verified
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      } disabled:opacity-50`}
                    >
                      {toggling === e.id ? "..." : e.tag_verified ? "✓ Verified" : "Verify Tag"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {e.eligible ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">Eligible</span>
                    ) : (
                      <span className="text-[10px] text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Past winners log */}
      {pastWinners.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Winner Selection History</h2>
          <div className="space-y-2">
            {pastWinners.map((w) => (
              <div key={w.id} className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600">
                <p>Selected: {new Date(w.selected_at).toLocaleString()}</p>
                <p>Method: {w.selection_method}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
