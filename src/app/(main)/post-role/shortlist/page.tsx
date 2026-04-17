"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface MatchedCandidate {
  id: string;
  display_name: string;
  country: string;
  role_category: string;
  hourly_rate: number;
  english_written_tier: string;
  us_client_experience: string;
  availability_status: string;
  total_earnings_usd: number;
  bio: string;
  profile_photo_url: string | null;
  match_score: number;
}

interface JobPostResult {
  jobPost: {
    id: string;
    role_category: string;
    hours_per_week: string;
    budget_range: string;
    start_date: string;
    description: string;
  };
  matches: MatchedCandidate[];
}

function tierColor(tier: string) {
  switch (tier) {
    case "exceptional": return "bg-green-100 text-green-700";
    case "proficient": return "bg-blue-100 text-blue-700";
    case "competent": return "bg-gray-100 text-gray-600";
    default: return "bg-gray-100 text-gray-600";
  }
}

function ShortlistContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get("id");
  const [result, setResult] = useState<JobPostResult | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  useEffect(() => {
    const stored = sessionStorage.getItem("job_post_result");
    if (stored) {
      try { setResult(JSON.parse(stored)); } catch { /* ignore */ }
    }
  }, []);

  async function handleInvite(candidateId: string, displayName: string) {
    setInviting(candidateId);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !result) return;
      await fetch("/api/jobs/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ job_post_id: jobId, candidate_id: candidateId, candidate_name: displayName, role_category: result.jobPost.role_category, hours_per_week: result.jobPost.hours_per_week, budget_range: result.jobPost.budget_range }),
      });
      setInvited((prev) => new Set(prev).add(candidateId));
    } catch { /* silent */ }
    setInviting(null);
  }

  if (!result) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-[#1C1B1A]">No results found</h1>
        <p className="mt-2 text-sm text-gray-500">Try posting a new role to get matched candidates.</p>
        <Link href="/post-role" className="mt-4 inline-block rounded-lg bg-[#FE6E3E] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B]">Post a Role</Link>
      </div>
    );
  }

  const { jobPost, matches } = result;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium uppercase tracking-wide text-[#FE6E3E]">Your Shortlist</span>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">{matches.length} match{matches.length !== 1 ? "es" : ""}</span>
        </div>
        <h1 className="text-2xl font-bold text-[#1C1B1A]">Top candidates for {jobPost.role_category}</h1>
        <p className="mt-1 text-sm text-gray-500">We matched these professionals to your requirements. Message them or send an invite to connect.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-orange-50 border border-orange-200 px-3 py-1 text-xs font-medium text-[#FE6E3E]">{jobPost.role_category}</span>
          <span className="rounded-full bg-gray-50 border border-gray-200 px-3 py-1 text-xs text-gray-600">{jobPost.hours_per_week}</span>
          <span className="rounded-full bg-gray-50 border border-gray-200 px-3 py-1 text-xs text-gray-600">{jobPost.budget_range}</span>
          <span className="rounded-full bg-gray-50 border border-gray-200 px-3 py-1 text-xs text-gray-600">Start: {jobPost.start_date}</span>
        </div>
      </div>

      {matches.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-500">No candidates matched your exact criteria. Try broadening your requirements.</p>
          <Link href={`/browse?role=${encodeURIComponent(jobPost.role_category)}`} className="mt-4 inline-block text-sm font-medium text-[#FE6E3E] hover:underline">Browse all {jobPost.role_category} professionals →</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {matches.map((candidate, index) => (
            <div key={candidate.id} className="rounded-lg border border-gray-200 bg-white p-5 hover:shadow-sm transition-shadow">
              <div className="flex items-start gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-50 text-sm font-bold text-[#FE6E3E]">{index + 1}</div>
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-gray-100">
                  {candidate.profile_photo_url ? (
                    <img src={candidate.profile_photo_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-lg font-bold text-gray-400">{candidate.display_name?.charAt(0) || "?"}</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-[#1C1B1A]">{candidate.display_name}</h3>
                      <p className="text-sm text-gray-500">{candidate.country} · {candidate.role_category}</p>
                    </div>
                    <p className="text-lg font-bold text-[#FE6E3E]">${candidate.hourly_rate?.toLocaleString()}<span className="text-xs font-normal text-gray-400">/hr</span></p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {candidate.english_written_tier && <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${tierColor(candidate.english_written_tier)}`}>{candidate.english_written_tier}</span>}
                    {(candidate.us_client_experience === "full_time" || candidate.us_client_experience === "part_time_contract") && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">US Experience</span>}
                    {candidate.total_earnings_usd > 0 && <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">${candidate.total_earnings_usd.toLocaleString()} earned</span>}
                  </div>
                  {candidate.bio && <p className="mt-2 text-sm text-gray-600 line-clamp-2">{candidate.bio}</p>}
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-gray-100"><div className="h-full rounded-full bg-[#FE6E3E]" style={{ width: `${candidate.match_score}%` }} /></div>
                    <span className="text-xs font-medium text-gray-500">{candidate.match_score}% match</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3 pl-[5.5rem]">
                <Link href={`/candidate/${candidate.id}`} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-[#1C1B1A] hover:bg-gray-50 transition-colors">View Profile</Link>
                <Link href={`/inbox?to=${candidate.id}`} className="rounded-lg bg-[#FE6E3E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors">Message</Link>
                <button onClick={() => handleInvite(candidate.id, candidate.display_name)} disabled={inviting === candidate.id || invited.has(candidate.id)} className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${invited.has(candidate.id) ? "border-green-200 bg-green-50 text-green-600 cursor-default" : "border-gray-200 text-[#1C1B1A] hover:border-[#FE6E3E] hover:text-[#FE6E3E]"} disabled:opacity-50`}>
                  {invited.has(candidate.id) ? "✓ Invited" : inviting === candidate.id ? "Sending..." : "Invite to Role"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 text-center">
        <Link href={`/browse?role=${encodeURIComponent(jobPost.role_category)}`} className="text-sm font-medium text-[#FE6E3E] hover:underline">Browse all {jobPost.role_category} professionals →</Link>
      </div>
      <div className="mt-4 text-center">
        <button onClick={() => { sessionStorage.removeItem("job_post_result"); router.push("/post-role"); }} className="text-sm text-gray-500 hover:text-[#1C1B1A]">Post another role</button>
      </div>
    </div>
  );
}

export default function ShortlistPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" /></div>}>
      <ShortlistContent />
    </Suspense>
  );
}
