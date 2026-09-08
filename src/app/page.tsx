import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { BROWSE_PILLS } from "@/lib/roleTaxonomy";
import LandingInteractive from "@/components/landing/LandingInteractive";
import AtlasNav from "@/components/landing/AtlasNav";
import AtlasFooter from "@/components/landing/AtlasFooter";
import "./landing.css";

export const metadata: Metadata = {
  title: 'StaffVA — Virtual Assistants & Remote Talent',
  description:
    'Browse remote professionals and see at a glance who cleared StaffVA screening — they carry a Vetted badge for a proctored skills interview and a human review. Listen to their voice samples, then hire with escrow protection.',
  openGraph: {
    title: 'StaffVA — Virtual Assistants & Remote Talent',
    description:
      'Browse remote professionals and see at a glance who cleared StaffVA screening — they carry a Vetted badge for a proctored skills interview and a human review. Listen to their voice samples, then hire with escrow protection.',
    siteName: 'StaffVA',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

const PILLS = BROWSE_PILLS;
const PILL_LABELS = BROWSE_PILLS.map((p) => p.label);

const FLAGS: Record<string, string> = {
  Philippines: "🇵🇭", India: "🇮🇳", Egypt: "🇪🇬", Kenya: "🇰🇪", Nigeria: "🇳🇬",
  Pakistan: "🇵🇰", Colombia: "🇨🇴", Argentina: "🇦🇷", Mexico: "🇲🇽", Brazil: "🇧🇷",
};
function flagFor(country: string | null): string {
  return (country && FLAGS[country]) || "🌍";
}
function initials(name: string | null): string {
  return (name || "?").split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

interface FeaturedCandidate {
  id: string;
  /** Canonical vetting flag — featured cards are drawn from assessed rows only. */
  ai_interview_passed?: boolean | null;
  display_name: string;
  role_category: string;
  hourly_rate: number;
  country: string | null;
  profile_photo_url: string | null;
  skills: string[] | null;
}

// One page of the live pool. The exact total comes from count:'exact';
// anything derived from the PAGE must degrade rather than under-report.
const LIVE_ROW_CAP = 1000;

interface LandingData {
  signups: number | null;
  liveCount: number;
  assessedCount: number | null;
  featured: FeaturedCandidate[];
  pillCounts: Record<string, number>;
}

// Every number on this page is live-rendered from the database — the
// owner's call: real figures that grow, never invented ones.
//
// The browsable pool holds two populations: people who cleared StaffVA's
// screening interview (the Vetted badge) and people who signed up and
// haven't finished it. So the page tracks BOTH counts and is careful about
// which one each sentence is allowed to use — vetting-flavoured claims get
// assessedCount, "how much is there to browse" gets liveCount.
//
// The old approvalPct/rejectPct are gone rather than rescoped: they read
// liveCount/applications as a screening funnel, and with unscreened
// signups approved onto the platform there is no honest percentage to
// print. Neither population is a rejection, so counts it is.
async function landingData(): Promise<LandingData> {
  const empty: LandingData = { signups: null, liveCount: 0, assessedCount: null, featured: [], pillCounts: {} };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return empty; // local dev has no service key by design
  try {
    const db = createClient(url, key);
    const [{ count: signups }, { data: liveRows, count: liveTotal }] = await Promise.all([
      db.from("candidates").select("*", { count: "exact", head: true }),
      db
        .from("candidates")
        .select("id, ai_interview_passed, display_name, role_category, hourly_rate, country, profile_photo_url, skills", { count: "exact" })
        .eq("admin_status", "approved")
      // Overdue-unverified profiles are hidden from clients (00154).
      .or("id_verification_status.in.(passed,manual_review),id_verification_due_at.is.null,id_verification_due_at.gt." + new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(LIVE_ROW_CAP),
    ]);
    const live = liveRows || [];
    const pillCounts: Record<string, number> = {};
    for (const p of PILLS) {
      pillCounts[p.label] = live.filter((c) => p.roles.includes(c.role_category)).length;
    }
    // The canonical vetting fact — same column every approval gate reads.
    // NOT the presence of an ai_interviews row: the 00143 re-verification
    // reset parked 52 scored interviews at 'failed_technical', so that table
    // reports one passed row while 30 people actually passed. Reading it
    // would have branded 29 vetted candidates "not yet assessed".
    const isAssessed = (c: { ai_interview_passed?: boolean | null }) =>
      c.ai_interview_passed === true;
    return {
      signups: signups ?? null,
      // The exact total, not the page size: the select is capped, so
      // live.length would silently under-report the pool it counts.
      liveCount: liveTotal ?? live.length,
      // Computed by intersecting the CAPPED page above with the assessed
      // set, while liveCount is an exact count. Past the cap those two
      // disagree and the badge number would silently under-report — worse
      // as the pool grows toward the 10k target. So past the cap it reports
      // null and the page falls back to prose: a number we cannot defend is
      // worse than no number.
      assessedCount: live.length >= LIVE_ROW_CAP ? null : live.filter(isAssessed).length,
      // Featured cards carry vetting chips and a check badge, so they are
      // drawn from the assessed set only. If too few have photos the section
      // hides itself (it already gates on >= 3) rather than padding with
      // profiles those chips would misdescribe.
      featured: (live as FeaturedCandidate[]).filter((c) => isAssessed(c) && c.profile_photo_url).slice(0, 8),
      pillCounts,
    };
  } catch {
    return empty;
  }
}

// Which prototype icon suits each pill (doc→Paralegal, check→Legal Asst, $→Bookkeeping…)
const ICON_FOR: number[] = [8, 11, 6, 3, 7, 4, 2, 9, 10, 1, 5, 4, 3, 6];

const CAT_ICONS: React.ReactNode[] = [
  (<svg key="cat-0" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>),
  (<svg key="cat-1" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" /></svg>),
  (<svg key="cat-2" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>),
  (<svg key="cat-3" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>),
  (<svg key="cat-4" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>),
  (<svg key="cat-5" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>),
  (<svg key="cat-6" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>),
  (<svg key="cat-7" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 11h-6M20 8v6" /></svg>),
  (<svg key="cat-8" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>),
  (<svg key="cat-9" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 5-5" /></svg>),
  (<svg key="cat-10" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>),
  (<svg key="cat-11" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>)
];



// Real client quotes only. The section renders the moment this array has
// entries — collect them from past engagement clients; never invent them.
const TESTIMONIALS: { quote: string; name: string; title: string; initials: string; grad: string }[] = [];

const FAQS: { q: string; a: string }[] = [
  { q: "What's your actual fee?", a: "A flat 10% on top of the candidate's rate — they keep 100% of what they quote. No markup on their rate, no service-fee creep, no premium tier. It's shown on every offer and every contract before you commit." },
  { q: "How rigorous is your vetting?", a: "Candidates carrying the Vetted badge passed a proctored skills interview scored on demonstrated evidence — not confident talk — and a person made the final approval call. Profiles without the badge signed up but haven't completed screening yet, so you can tell the two apart before you reach out." },
  { q: "How fast can I hire?", a: "Browse without an account. When someone fits, book an interview directly on their published calendar — the call happens right here on StaffVA. Send an offer after the call; the contract generates itself and escrow opens when you fund it. Days, not weeks." },
  { q: "What if the hire doesn't work out?", a: "You fund work in periods, and each period has a 48-hour dispute window after it ends. Funds sit in escrow until you release them or a dispute is resolved — by a person, not an algorithm." },
  { q: "Where are candidates based?", a: "Mostly the Philippines, with strong benches in Egypt, India, Kenya and Nigeria. Every profile shows the candidate's timezone in plain words, and the booking calendar warns you when a slot lands outside their waking hours." },
  { q: "Is my hiring activity public?", a: "No. Clients have no public profiles, contact details are masked on both sides until a contract exists, and interviews happen on-platform — recorded and reviewed to keep both sides protected." },
  { q: "Is my money actually protected?", a: "Payments run through Stripe into escrow. Money releases to the candidate when you approve the work or a period completes without dispute — never before." },
  { q: "Do I need to sign up to browse?", a: "No — the full pool is open. A free account unlocks voice intros, messaging, and booking interviews." },
];

export default async function LandingPage() {
  const data = await landingData();

  return (
    <div className="lp">
      {/* Fraunces is the landing's display face; the rest of the app keeps its own fonts. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Geist:wght@300..900&family=Geist+Mono:wght@400..600&display=swap"
        rel="stylesheet"
      />
<AtlasNav />
<main>

<section id="hero" className="hero">
  <div className="container">
    <div className="hero-grid">
      <div className="hero-left reveal">
        <div className="hero-badge">
          <span className="hero-badge-dot">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </span>
          Vetted bench. Human-reviewed. Look for the badge.
        </div>
        <h1 className="display">
          Hire <span className="serif-italic">vetted</span><br />
          global A-players.<br />
          <span className="underline-accent">Browse</span> before<br />
          signing up.
        </h1>
        <p className="hero-sub">
          Candidates with the <strong>Vetted badge</strong> passed a proctored skills interview and a <strong>human review</strong> before going live. Explore the full pool. Sign up only when you&apos;re ready to act.
        </p>

        {/* Search */}
        <form className="search" action="/browse" method="get">
          <div className="search-field">
            <label>Role category</label>
            <select name="role" defaultValue="">
              <option value="">Any role</option>
              {PILL_LABELS.map((p) => (<option key={p} value={p}>{p}</option>))}
            </select>
          </div>
          <div className="search-field">
            <label>Core skills</label>
            <input type="text" name="skills" placeholder="Clio, QuickBooks, Figma…" />
          </div>
          <div className="search-field">
            <label>Max rate / hr</label>
            <input type="text" name="maxRate" placeholder="$12" />
          </div>
          <button type="submit" className="search-submit" aria-label="Search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          </button>
        </form>

        <p className="hero-secondary">
          Looking for work instead? <a href="/signup/candidate">Apply to join the pool →</a>
        </p>

        {/* Live stats */}
        <div className="live-stats">
          {/* "Applications reviewed" counted every candidate row, including
              people who signed up and never submitted anything to review.
              The query counts signups, so the label says signups. */}
          <div className="live-stat">
            <div className="live-stat-num">{data.signups === null ? "—" : data.signups.toLocaleString()}</div>
            <div className="live-stat-label">Candidate signups</div>
          </div>
          {data.assessedCount !== null && (
            <div className="live-stat">
              <div className="live-stat-num"><span className="live-dot"></span>{data.assessedCount.toLocaleString()}</div>
              <div className="live-stat-label">Vetted candidates live</div>
            </div>
          )}
          {/* Was a hardcoded "100% / Camera-proctored" — an assertion about
              every profile, which the page does not check and is no longer
              true. Replaced with the browsable total, which it does know. */}
          <div className="live-stat">
            <div className="live-stat-num">{data.liveCount.toLocaleString()}</div>
            <div className="live-stat-label">Profiles to browse</div>
          </div>
        </div>
      </div>

      {/* Hero visual: layered candidate cards */}
      {data.featured.length >= 3 && (
      <div className="hero-visual reveal" style={{transitionDelay:".15s"}}>
        {data.featured.slice(0, 3).map((c, i) => (
          <div key={c.id} className={"hero-card hero-card-" + (i + 1)}>
            <div className="hc-top">
              <div className="hc-avatar" style={c.profile_photo_url ? {backgroundImage:"url(" + c.profile_photo_url + ")",backgroundSize:"cover",backgroundPosition:"center",color:"transparent"} : {background:"linear-gradient(135deg, #FFD6A5, #FFA07A)"}}>{initials(c.display_name)}</div>
              <div className="hc-info">
                <div className="hc-name">{c.display_name} <span className="hc-verify"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></span></div>
                <div className="hc-role">{c.role_category} · {flagFor(c.country)} {c.country}</div>
              </div>
            </div>
            <div className="hc-tags">
              {(c.skills || []).slice(0, 3).map((s) => (<span key={s} className="hc-tag">{s}</span>))}
            </div>
            <div className="hc-stats">
              <div><div className="hc-stat-val">{"$" + Number(c.hourly_rate) + "/hr"}</div><div className="hc-stat-lbl">Rate</div></div>
              {/* These cards are drawn from the assessed set only (see
                  landingData), so both chips are true of the person shown.
                  The old "ID ✓ / Verified" was not: the live-profile filter
                  also admits manual_review and not-yet-due profiles. */}
              <div><div className="hc-stat-val">Vetted</div><div className="hc-stat-lbl">Screened</div></div>
              <div><div className="hc-stat-val">Proctored</div><div className="hc-stat-lbl">Interview</div></div>
            </div>
          </div>
        ))}
        <div className="hero-floating-tag">10% flat fee</div>
      </div>
      )}
    </div>
  </div>
</section>

<section id="pricing" className="fees">
  <div className="container">
    <div className="section-head reveal">
      <div>
        <div className="eyebrow">{"// Pricing that isn't a markup"}</div>
        <h2 className="display">Half the fees.<br /><span className="serif-italic">None</span> of the guesswork.</h2>
      </div>
      <p className="section-head-copy">
        Most marketplaces take 10–20% out of the worker&apos;s side and bury the rest in opaque bill-rates. We charge a flat 10% on top — disclosed upfront, visible in every contract, and your hire keeps 100% of their rate.
      </p>
    </div>

    <div className="fees-compare">
      <div className="fee-bars reveal-stagger">
        <div className="fee-bar fee-bar-us">
          <div className="fee-bar-label">StaffVA</div>
          <div className="fee-bar-track"><div className="fee-bar-fill" style={{width:"25%"}}></div></div>
          <div className="fee-bar-pct">10%</div>
        </div>
        <div className="fee-bar">
          <div className="fee-bar-label">Typical marketplace</div>
          <div className="fee-bar-track"><div className="fee-bar-fill" style={{width:"50%"}}></div></div>
          <div className="fee-bar-pct">20%</div>
        </div>
        <div className="fee-bar">
          <div className="fee-bar-label">Freelance platforms</div>
          <div className="fee-bar-track"><div className="fee-bar-fill" style={{width:"50%"}}></div></div>
          <div className="fee-bar-pct">20%</div>
        </div>
        <div className="fee-bar">
          <div className="fee-bar-label">Managed agencies</div>
          <div className="fee-bar-track"><div className="fee-bar-fill" style={{width:"85%"}}></div></div>
          <div className="fee-bar-pct">~50%</div>
        </div>
      </div>

      {/* Calculator */}
      <div className="calc reveal" style={{transitionDelay:".1s"}}>
        <div className="calc-title">See what you&apos;d save in a year.</div>

        <div className="calc-field">
          <div className="calc-label">
            <span className="calc-label-name">Hire rate / hour</span>
            <span className="calc-label-val" id="rateVal">$40</span>
          </div>
          <input type="range" id="rateSlider" min="15" max="120" defaultValue="40" />
        </div>

        <div className="calc-field">
          <div className="calc-label">
            <span className="calc-label-name">Hours per week</span>
            <span className="calc-label-val" id="hoursVal">40</span>
          </div>
          <input type="range" id="hoursSlider" min="5" max="40" defaultValue="40" />
        </div>

        <div className="calc-output">
          <div className="calc-saving" id="savingVal">$8,320</div>
          <div className="calc-saving-sub">saved per year vs a typical 20% marketplace</div>
        </div>

        <a href="/browse" className="btn btn-lime btn-lg" style={{marginTop:"24px",width:"100%",justifyContent:"center"}}>
          Browse Talent
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
        </a>
      </div>
    </div>
  </div>
</section>

{data.featured.length >= 3 && (
<section id="featured" className="featured">
  <div className="container">
    <div className="section-head reveal">
      <div>
        <div className="eyebrow">{"// Featured this week"}</div>
        <h2 className="display">Meet a few of our<br />vetted <span className="serif-italic">A-players</span>.</h2>
      </div>
      <p className="section-head-copy">
        Click any card for the full profile. Video intros, messaging, proposals, and booking an interview require a free account — everything else stays open.
      </p>
    </div>

    <div className="carousel-wrap">
      <div className="carousel reveal-stagger" id="carousel">
        {data.featured.map((c) => (
          <a key={c.id} href={"/candidate/" + c.id} className="candidate-card">
            <div className="video-thumb">
              <div className="video-thumb-bg" style={c.profile_photo_url ? {backgroundImage:"url(" + c.profile_photo_url + ")",backgroundSize:"cover",backgroundPosition:"center"} : {background:"linear-gradient(135deg, #2b4a3e 0%, #5a8b73 100%)"}}>
                <div className="video-lock">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  SIGN UP
                </div>
                <div className="video-flag">{flagFor(c.country)}</div>
              </div>
            </div>
            <div className="cc-name-row">
              <div>
                <div className="cc-name">{c.display_name}</div>
                <div className="cc-role">{c.role_category}</div>
              </div>
            </div>
            <div className="cc-meta">
              {(c.skills || []).slice(0, 2).map((s) => (<span key={s} className="cc-tag">{s}</span>))}
              {(c.skills || []).length > 2 && <span className="cc-tag">+{(c.skills || []).length - 2}</span>}
            </div>
            <div className="cc-bottom">
              <div className="cc-rate">{"$" + Number(c.hourly_rate)}<span>/hr</span></div>
            </div>
          </a>
        ))}
      </div>

      <div className="carousel-controls">
        <a href="/browse" className="view-all">Browse all {data.liveCount.toLocaleString()} candidates →</a>
        <div className="carousel-arrows">
          <button className="carousel-arrow" aria-label="Previous">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <button className="carousel-arrow" aria-label="Next">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</section>
)}

<section id="vetting" className="vetting">
  <div className="container vetting-inner">
    <div className="vetting-head reveal">
      <div className="eyebrow">{"// How vetting works"}</div>
      <h2 className="display">What <span className="serif-italic">vetted</span><br />actually means.</h2>
      <p>Candidates carrying the Vetted badge cleared two gates &mdash; a proctored skills interview and a final review before the badge went on. Profiles without it signed up but haven&apos;t finished screening yet. This is the filter we&apos;d want if we were hiring.</p>
    </div>

    <div className="vetting-steps reveal-stagger">
      <div className="vstep">
        <div className="vstep-num">01</div>
        {/* The English assessment came out of this step: platform-wide the
            scores were reset after the test was found defective, so there is
            no English result to stand behind. The skills interview is the
            gate the badge is actually derived from. */}
        <h3>Proctored<br />skills interview.</h3>
        <p>A structured skills interview scored on demonstrated evidence. The session is camera-proctored, recorded, and integrity-checked &mdash; a proctored exam, end to end.</p>
        <div className="vstep-meta">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          RECORDED · INTEGRITY-CHECKED
        </div>
      </div>

      <div className="vstep">
        <div className="vstep-num">02</div>
        <h3>Profile and intro recorded.</h3>
        {/* ID verification dropped from the claim: the live-profile filter
            admits manual_review and not-yet-due profiles, so "ID-verified"
            is not something this page can assert about a given candidate. */}
        <p>The candidate builds their profile and records a voice intro. Nothing goes public yet.</p>
        <div className="vstep-meta">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" /></svg>
          VOICE INTRO ON FILE
        </div>
      </div>

      <div className="vstep">
        <div className="vstep-num">03</div>
        <h3>Talent Specialist review.</h3>
        <p>A person reviews the full scorecard &mdash; the interview, the profile and intro &mdash; then approves, requests revisions, or rejects. Only then does the Vetted badge go on.</p>
        <div className="vstep-meta">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
          ONE COMPREHENSIVE REVIEW
        </div>
      </div>
    </div>

    <div className="vetting-stat reveal">
      {/* Was an approval/rejection rate derived from liveCount/applications.
          That read the whole approved pool as "everyone who passed", which
          it no longer is — so the stat is now the plain count of who holds
          the badge, against the pool you can actually browse. */}
      <div className="vetting-stat-num">
        {data.assessedCount !== null && data.liveCount > 0 ? data.assessedCount.toLocaleString() : "…"}
      </div>
      <div className="vetting-stat-label">
        {data.assessedCount !== null && data.liveCount > 0
          ? "of " + data.liveCount.toLocaleString() + " profiles open to browse carry the Vetted badge. The rest signed up but haven't completed screening yet."
          : "Look for the Vetted badge — it marks the candidates who completed screening."}
      </div>
      <a href="/signup/candidate">See the full vetting process →</a>
    </div>
  </div>
</section>

<section id="categories" className="categories">
  <div className="container">
    <div className="section-head reveal">
      <div>
        <div className="eyebrow">{"// Role categories"}</div>
        <h2 className="display">Hire across<br /><span className="serif-italic">{PILLS.length} disciplines.</span></h2>
      </div>
      <p className="section-head-copy">From paralegals to specialist VAs. Book an interview straight from any live candidate&apos;s calendar.</p>
    </div>

    <div className="cat-grid reveal-stagger">
      {PILLS.map((p, i) => (
        <a key={p.label} href={"/browse?role=" + encodeURIComponent(p.label)} className="cat-tile">
          <div className="cat-icon">{CAT_ICONS[ICON_FOR[i] ?? i % CAT_ICONS.length]}</div>
          <div>
            <div className="cat-name">{p.label}</div>
            <div className="cat-count">
              {(data.pillCounts[p.label] || 0) > 0
                ? (<><span className="pulse-dot"></span>{data.pillCounts[p.label]} live</>)
                : (<>re-verifying</>)}
            </div>
          </div>
          <div className="cat-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M7 7h10v10" /></svg></div>
        </a>
      ))}
    </div>
  </div>
</section>

{TESTIMONIALS.length > 0 && (
<section className="testimonials">
  <div className="container">
    <div className="section-head reveal">
      <div>
        <div className="eyebrow">{"// What clients say"}</div>
        <h2 className="display">Hires who<br /><span className="serif-italic">stayed.</span></h2>
      </div>
      <p className="section-head-copy">We care less about first-month reviews than about the people still working together a year in.</p>
    </div>
    <div className="test-grid reveal-stagger">
      {TESTIMONIALS.map((t) => (
        <div key={t.name} className="test-card">
          <div className="test-stars">★★★★★</div>
          <div className="test-quote">&ldquo;{t.quote}&rdquo;</div>
          <div className="test-author">
            <div className="test-avatar" style={{background: t.grad}}>{t.initials}</div>
            <div>
              <div className="test-name">{t.name}</div>
              <div className="test-company">{t.title}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
</section>
)}

<section className="candidate-cta">
  <div className="container">
    <div className="cand-block reveal">
      <div className="cand-content">
        <div className="eyebrow cand-eyebrow">{"// For candidates"}</div>
        <h2 className="display">Are you an<br /><span className="lime">A-player?</span><br />Apply to join.</h2>
        <p>The Vetted badge takes a proctored skills interview and a human review &mdash; but once you&apos;re through, you work with US clients who pay full rate. No platform fees, ever.</p>
        <a href="/signup/candidate" className="btn btn-lime btn-lg">
          Apply to Join
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
        </a>
      </div>

      <div className="cand-benefits">
        <div className="cand-benefit">
          <div className="cand-benefit-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
          </div>
          <div>
            <div className="cand-benefit-title">0% fees, forever</div>
            <div className="cand-benefit-sub">Keep 100% of your hourly rate. Clients pay the 10%.</div>
          </div>
        </div>
        <div className="cand-benefit">
          <div className="cand-benefit-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
          </div>
          <div>
            <div className="cand-benefit-title">US clients</div>
            <div className="cand-benefit-sub">Serious companies with budgets who hire, not bargain.</div>
          </div>
        </div>
        <div className="cand-benefit">
          <div className="cand-benefit-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
          </div>
          <div>
            <div className="cand-benefit-title">Clients book you directly</div>
            <div className="cand-benefit-sub">Publish your hours — interviews land on your calendar, offers on the platform.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<section className="trust-strip">
  <div className="container">
    <div className="trust-grid">
      <div className="trust-item">
        <div className="trust-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
        </div>
        <div className="trust-text"><strong>Vetted badge</strong>Shows who cleared screening.</div>
      </div>
      <div className="trust-item">
        <div className="trust-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
        </div>
        <div className="trust-text"><strong>Skills examined</strong>Scored on what they showed, not how they talk.</div>
      </div>
      <div className="trust-item">
        <div className="trust-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
        </div>
        <div className="trust-text"><strong>Interview integrity</strong>Recorded and human-reviewed.</div>
      </div>
      <div className="trust-item">
        <div className="trust-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
        </div>
        <div className="trust-text"><strong>Auto contracts</strong>Generated the moment you hire.</div>
      </div>
      <div className="trust-item">
        <div className="trust-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        </div>
        <div className="trust-text"><strong>Escrow protected</strong>Funds held until work is confirmed.</div>
      </div>
      <div className="trust-item">
        <div className="trust-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
        </div>
        <div className="trust-text"><strong>48h dispute window</strong>Funds stay in escrow until a person resolves it.</div>
      </div>
      <div className="trust-item">
        <div className="trust-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        </div>
        <div className="trust-text"><strong>Privacy by default</strong>Clients aren&apos;t publicly listed.</div>
      </div>
    </div>
  </div>
</section>

<section className="hp-privacy-strip">
  <div className="hp-privacy-strip-inner">
    <div className="hp-privacy-mark">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
    </div>
    <div className="hp-privacy-text">
      <div className="hp-privacy-eyebrow"><span>&bull;</span> Privacy by default</div>
      <div className="hp-privacy-headline">Clients aren&apos;t publicly listed. <span className="italic">Their hiring stays their own.</span></div>
      <p className="hp-privacy-detail">StaffVA keeps client identities private until a hire is made. <strong>Candidates and clients only see each other once a real relationship begins</strong> &mdash; no off-platform poaching, no public hiring trail, no data harvesting. We built StaffVA this way on purpose.</p>
    </div>
    <a href="/privacy" className="hp-privacy-link">
      How privacy works
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
    </a>
  </div>
</section>

<section className="faq">
  <div className="container">
    <div className="faq-grid">
      <div className="faq-head reveal">
        <div className="eyebrow">{"// Common questions"}</div>
        <h2 className="display">Things<br />people ask.</h2>
        <p>Still have questions? Drop us a note and we&apos;ll answer within a day.</p>
        <a href="mailto:hello@staffva.com" className="btn btn-outline">Contact us</a>
      </div>

      <div className="faq-list reveal" style={{transitionDelay:".1s"}}>
        {FAQS.map((f) => (
          <div key={f.q} className="faq-item">
            <button className="faq-q">
              <span>{f.q}</span>
              <span className="faq-q-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </span>
            </button>
            <div className="faq-a">{f.a}</div>
          </div>
        ))}
      </div>
    </div>
  </div>
</section>

</main>

<AtlasFooter />

      <LandingInteractive />
    </div>
  );
}
