"use client";

import { useState } from "react";

const REVISION_CATEGORIES = [
  {
    category: "Profile photo",
    items: [
      "Profile photo — Missing — upload headshot",
      "Profile photo — Replace — unprofessional or low resolution",
    ],
  },
  {
    category: "Bio",
    items: [
      "Bio — Missing",
      "Bio — Too short — needs more detail",
      "Bio — Needs rewrite — grammar or tone",
    ],
  },
  {
    category: "Tagline",
    items: [
      "Tagline — Missing",
      "Tagline — Too generic — be role-specific",
    ],
  },
  {
    // Was "Resume". Candidates cannot upload one any more, so asking for it
    // sent them back to a screen with no such field and no way to comply.
    category: "Work samples",
    items: [
      "Work samples — Add at least one sample of your work",
      "Work samples — Replace — the sample doesn't show the work you're applying for",
      "Work samples — Remove personal contact details from the file",
    ],
  },
  {
    category: "Work experience",
    items: [
      "Work experience — Add company name and job title",
      "Work experience — Add employment dates",
      "Work experience — Add responsibilities and achievements",
    ],
  },
  {
    category: "Skills and tools",
    items: [
      "Skills and tools — Skills don't match stated experience",
      "Skills and tools — Add key tools for this role",
    ],
  },
  {
    category: "Voice recordings",
    items: [
      "Voice recordings — Oral reading — re-record (audio quality or background noise)",
      "Voice recordings — Oral reading — re-record (states full surname — first name only per platform privacy policy)",
      "Voice recordings — Self-introduction — re-record (audio quality, too short, or off-topic)",
      "Voice recordings — Self-introduction — re-record (states full surname — first name only per platform privacy policy)",
    ],
  },
  {
    category: "Video introduction",
    items: [
      "Video introduction — Missing — upload video introduction",
      "Video introduction — Re-record — audio or video quality issues",
      "Video introduction — Re-record — too short or off-topic",
      "Video introduction — Re-record — unprofessional setting or appearance",
      "Video introduction — Re-record — states full surname — first name only per platform privacy policy",
    ],
  },
  {
    category: "Verification",
    items: [
      "Verification — ID verification — retry",
      "Verification — Interview consent — confirm",
      "Verification — Payout method — select",
    ],
  },
];

interface RevisionModalProps {
  candidateName: string;
  candidateId: string;
  token: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export default function RevisionModal({ candidateName, candidateId, token, onClose, onSubmitted }: RevisionModalProps) {
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  function toggleItem(item: string) {
    const next = new Map(selected);
    if (next.has(item)) {
      next.delete(item);
    } else {
      next.set(item, "");
    }
    setSelected(next);
  }

  function updateNote(item: string, note: string) {
    const next = new Map(notes);
    next.set(item, note);
    setNotes(next);
  }

  async function handleSubmit() {
    if (selected.size === 0) return;
    setSubmitting(true);

    const items = Array.from(selected.keys()).map((type) => ({
      type,
      note: notes.get(type) || "",
    }));

    try {
      const res = await fetch("/api/recruiter/revisions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ candidateId, items }),
      });
      if (res.ok) {
        onSubmitted();
      }
    } catch { /* silent */ }
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] rounded-xl bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#1C1B1A]">Request Revision</h2>
            <p className="text-sm text-gray-500">{candidateName} &middot; {selected.size} item{selected.size !== 1 ? "s" : ""} selected</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100">
            <svg className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {REVISION_CATEGORIES.map((cat) => (
            <div key={cat.category}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{cat.category}</h3>
              <div className="space-y-1.5">
                {cat.items.map((item) => {
                  const isSelected = selected.has(item);
                  const isNoteOpen = expandedNote === item;
                  return (
                    <div key={item}>
                      <div
                        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                          isSelected ? "bg-orange-50 border border-orange-200" : "hover:bg-gray-50 border border-transparent"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleItem(item)}
                          className="h-4 w-4 rounded border-gray-300 text-[#FE6E3E] focus:ring-[#FE6E3E]"
                        />
                        <span
                          className="flex-1 text-sm text-[#1C1B1A] cursor-pointer"
                          onClick={() => toggleItem(item)}
                        >
                          {item.split(" — ").slice(1).join(" — ")}
                        </span>
                        {isSelected && (
                          <button
                            onClick={() => setExpandedNote(isNoteOpen ? null : item)}
                            className="text-[10px] text-[#FE6E3E] font-medium hover:underline"
                          >
                            {isNoteOpen ? "close" : "+ note"}
                          </button>
                        )}
                      </div>
                      {isSelected && isNoteOpen && (
                        <textarea
                          value={notes.get(item) || ""}
                          onChange={(e) => updateNote(item, e.target.value)}
                          placeholder="Add specific guidance..."
                          rows={2}
                          className="mt-1 ml-10 w-[calc(100%-2.5rem)] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E]"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-200 px-6 py-4 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-[#1C1B1A] hover:bg-gray-50">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={submitting || selected.size === 0}
            className="flex-1 rounded-lg bg-[#FE6E3E] py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B] disabled:opacity-50"
          >
            {submitting ? "Sending..." : `Send Revision Request (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
