"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { labelFor } from "@/lib/editFieldLabels";
import EditModal from "@/components/candidate/edit/EditModal";
import PendingEditsSection from "@/components/candidate/edit/PendingEditsSection";

// Fields exposed on this page, in display order.
const EDITABLE_FIELDS: string[] = [
  "tagline",
  "bio",
  "role_category",
  "country",
  "hourly_rate",
  "years_experience",
  "us_client_experience",
  "skills",
  "tools",
  "work_experience",
  "profile_photo_url",
  "video_intro_url",
  "voice_recording_1_url",
  "voice_recording_2_url",
];

type Candidate = {
  id: string;
  user_id: string;
  assigned_recruiter: string | null;
  tagline: string | null;
  bio: string | null;
  role_category: string | null;
  country: string | null;
  hourly_rate: number | null;
  years_experience: string | null;
  us_client_experience: string | null;
  skills: string[] | null;
  tools: string[] | null;
  work_experience: unknown[] | null;
  profile_photo_url: string | null;
  video_intro_url: string | null;
  voice_recording_1_url: string | null;
  voice_recording_2_url: string | null;
};

export default function EditProfilePage() {
  const router = useRouter();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [pendingFields, setPendingFields] = useState<Set<string>>(new Set());
  const [declinedCount, setDeclinedCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    const { data: c } = await supabase
      .from("candidates")
      .select(
        "id, user_id, assigned_recruiter, tagline, bio, role_category, country, hourly_rate, years_experience, us_client_experience, skills, tools, work_experience, profile_photo_url, video_intro_url, voice_recording_1_url, voice_recording_2_url"
      )
      .eq("user_id", user.id)
      .single();
    setCandidate(c as Candidate);

    const resp = await fetch("/api/candidate/edit-requests");
    if (resp.ok) {
      const body = await resp.json();
      const pending = new Set<string>();
      let declined = 0;
      for (const r of body.requests ?? []) {
        if (r.status === "pending") pending.add(r.field_name);
        if (r.status === "declined") declined++;
      }
      setPendingFields(pending);
      setDeclinedCount(declined);
    }

    setLoading(false);
  }, [router]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const assigned = !!candidate?.assigned_recruiter;

  const editableList = useMemo(() => EDITABLE_FIELDS.map((f) => ({
    fieldName: f,
    current: candidate ? (candidate as unknown as Record<string, unknown>)[f] : null,
    pending: pendingFields.has(f),
  })), [candidate, pendingFields]);

  if (loading) {
    return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-text/60">Loading…</div>;
  }
  if (!candidate) {
    return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-red-600">No candidate record found.</div>;
  }

  const onSubmitted = () => {
    setEditingField(null);
    setRefreshKey((k) => k + 1);
    refresh();
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold text-text">Edit your profile</h1>
      <p className="mt-1 text-sm text-text/60">
        Changes are reviewed by your recruiter before going live.
      </p>

      {!assigned && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Profile edits are available once you&apos;re assigned to a recruiter.
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text/50">Fields</h2>
        <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {editableList.map(({ fieldName, current, pending }) => (
            <li key={fieldName} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">{labelFor(fieldName)}</p>
                <p className="mt-0.5 truncate text-xs text-text/60">{formatCurrent(fieldName, current)}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingField(fieldName)}
                disabled={!assigned || pending}
                title={
                  !assigned
                    ? "Available after you're assigned a recruiter"
                    : pending
                    ? "You already have a pending edit for this field"
                    : ""
                }
                className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-text hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pending ? "Pending review" : "Edit"}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text/50">My pending edits</h2>
          {declinedCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700"
              title={`${declinedCount} declined edit${declinedCount === 1 ? "" : "s"} need attention`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-red-600" />
              {declinedCount} declined
            </span>
          )}
        </div>
        <div className="mt-2">
          <PendingEditsSection refreshKey={refreshKey} onChanged={onSubmitted} />
        </div>
      </section>

      {editingField && (
        <EditModal
          fieldName={editingField}
          currentValue={(candidate as unknown as Record<string, unknown>)[editingField]}
          onClose={() => setEditingField(null)}
          onSubmitted={onSubmitted}
        />
      )}
    </div>
  );
}

function formatCurrent(fieldName: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "(not set)";
  if (Array.isArray(v)) {
    if (v.length === 0) return "(empty)";
    if (fieldName === "work_experience") return `${v.length} entr${v.length === 1 ? "y" : "ies"}`;
    return (v as unknown[]).slice(0, 4).map(String).join(", ") + (v.length > 4 ? "…" : "");
  }
  const s = String(v);
  return s.length > 100 ? s.slice(0, 100) + "…" : s;
}
