import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { assertFootageAccess, loadRecordingIndex } from "@/lib/adminRecordings";
import RecordingsIndexView from "@/components/admin/recordings/RecordingsIndexView";
import VideoIntroQueue from "@/components/admin/recordings/VideoIntroQueue";

export const dynamic = "force-dynamic";

/**
 * Video reviews: a folder per person, and inside it a folder per assessment
 * and per attempt.
 *
 * This URL used to hold only the video-intro approval queue. That queue is
 * still here, as the second tab, untouched — it is a different job (approving
 * a profile video) from the one this page is now for (finding the recording
 * of a particular sitting), and it was the only thing a rail row called
 * "Video Reviews" led to while 900 files of proctor footage had no way to be
 * browsed at all.
 */
export default async function VideoReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const showIntros = view === "intros";

  // Talent specialists approve intro videos but do not get proctor footage.
  const footageAccess = await assertFootageAccess();

  // How many intro videos are waiting, for the tab. null = could not be read,
  // which the tab shows as no number rather than as zero.
  const { count: pendingIntros, error: introErr } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).from("candidates").select("id", { count: "exact", head: true }).eq("video_intro_status", "pending_review");

  const people = !showIntros && footageAccess ? await loadRecordingIndex() : null;

  return (
    <div className="adm-col" style={{ maxWidth: 1180 }}>
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Trust &amp; Safety</div>
          <h1>Recordings, <span className="adm-serif-italic">by person.</span></h1>
          <div className="adm-subhead">
            One folder each · English test, Interview 1 and Interview 2 inside · one folder per attempt
          </div>
        </div>
      </div>

      <div className="alerts-filter-row" role="tablist" style={{ marginBottom: 18 }}>
        <Link href="/admin/video-reviews" role="tab" aria-selected={!showIntros} className={`alerts-filter${!showIntros ? " active" : ""}`}>
          Assessment recordings
          {people && <span className="filter-count">{people.length}</span>}
        </Link>
        <Link href="/admin/video-reviews?view=intros" role="tab" aria-selected={showIntros} className={`alerts-filter${showIntros ? " active" : ""}`}>
          Intro video approvals
          {!introErr && pendingIntros !== null && <span className="filter-count">{pendingIntros}</span>}
        </Link>
      </div>

      {showIntros ? (
        <VideoIntroQueue />
      ) : !footageAccess ? (
        <div className="adm-state">
          <strong>Assessment recordings are limited to administrators and recruiting managers.</strong>
          <p style={{ marginTop: 8 }}>Intro video approvals are in the other tab.</p>
        </div>
      ) : people === null ? (
        <div className="adm-state error" role="alert">
          <strong>The recordings could not be listed.</strong>
          <p style={{ marginTop: 8 }}>
            This is a failed read, not an empty library. If it persists, check that the{" "}
            <code>admin_recording_index</code> migration has been applied and that{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code> is set.
          </p>
        </div>
      ) : (
        <RecordingsIndexView people={people} />
      )}
    </div>
  );
}
