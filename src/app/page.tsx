import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { BROWSE_PILLS } from "@/lib/roleTaxonomy";
import LandingInteractive from "@/components/landing/LandingInteractive";
import "./landing.css";

export const metadata: Metadata = {
  title: 'StaffVA — Vetted Virtual Assistants & Remote Talent',
  description:
    'Browse remote professionals who passed a written English assessment, government-ID verification, and a skills interview before their profile went live. Listen to their voice samples, then hire with escrow protection.',
  openGraph: {
    title: 'StaffVA — Vetted Virtual Assistants & Remote Talent',
    description:
      'Browse remote professionals who passed a written English assessment, government-ID verification, and a skills interview before their profile went live. Listen to their voice samples, then hire with escrow protection.',
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
  display_name: string;
  role_category: string;
  hourly_rate: number;
  country: string | null;
  profile_photo_url: string | null;
  skills: string[] | null;
}

interface LandingData {
  applications: number | null;
  liveCount: number;
  featured: FeaturedCandidate[];
  pillCounts: Record<string, number>;
  approvalPct: number | null;
  rejectPct: number | null;
}

// Every number on this page is live-rendered from the database — the
// owner's call: real figures that grow, never invented ones. Percentages
// hold back until at least 3 candidates are live so the re-verification
// window can't render absurdities ("we reject 100%").
async function landingData(): Promise<LandingData> {
  const empty: LandingData = { applications: null, liveCount: 0, featured: [], pillCounts: {}, approvalPct: null, rejectPct: null };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return empty; // local dev has no service key by design
  try {
    const db = createClient(url, key);
    const [{ count: applications }, { data: liveRows }] = await Promise.all([
      db.from("candidates").select("*", { count: "exact", head: true }),
      db
        .from("candidates")
        .select("id, display_name, role_category, hourly_rate, country, profile_photo_url, skills")
        .eq("admin_status", "approved")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    const live = liveRows || [];
    const pillCounts: Record<string, number> = {};
    for (const p of PILLS) {
      pillCounts[p.label] = live.filter((c) => p.roles.includes(c.role_category)).length;
    }
    const liveCount = live.length;
    const showPcts = applications && liveCount >= 3;
    return {
      applications: applications ?? null,
      liveCount,
      featured: (live as FeaturedCandidate[]).filter((c) => c.profile_photo_url).slice(0, 8),
      pillCounts,
      approvalPct: showPcts ? Math.round((liveCount / applications) * 100) : null,
      rejectPct: showPcts ? Math.round((1 - liveCount / applications) * 100) : null,
    };
  } catch {
    return empty;
  }
}

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
<nav className="nav" id="nav">
  <div className="nav-inner">
    <Link href="/" className="logo">
      <span className="logo-mark"></span>
      <span>StaffVA</span>
    </Link>
    <div className="nav-links">
      <a href="/browse" className="nav-link">Find Talent</a>
      <a href="/signup/client" className="nav-link">For Businesses</a>
      <a href="/signup/candidate" className="nav-link">For Candidates</a>
      <a href="#vetting" className="nav-link">How It Works</a>
      <a href="#pricing" className="nav-link">Pricing</a>
    </div>
    <div className="nav-actions">
      <a href="/login" className="btn btn-ghost">Sign In</a>
      <a href="/signup/client" className="btn btn-primary">Sign Up</a>
      <button className="hamburger" aria-label="Menu">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
      </button>
    </div>
  </div>
</nav>
<main>

<section id="hero" className="hero">
  <div className="container">
    <div className="hero-grid">
      <div className="hero-left reveal">
        <div className="hero-badge">
          <span className="hero-badge-dot">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </span>
          Pre-vetted. Human-reviewed. A-players only.
        </div>
        <h1 className="display">
          Hire <span className="serif-italic">pre-vetted</span><br />
          global A-players.<br />
          <span className="underline-accent">Browse</span> before<br />
          signing up.
        </h1>
        <p className="hero-sub">
          Every candidate passes a <strong>camera-proctored English assessment</strong>, a proctored skills interview, and a <strong>final review</strong> before going live. Explore the full pool. Sign up only when you&apos;re ready to act.
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
          <div className="live-stat">
            <div className="live-stat-num">{data.applications === null ? "—" : data.applications.toLocaleString()}</div>
            <div className="live-stat-label">Applications reviewed</div>
          </div>
          <div className="live-stat">
            <div className="live-stat-num"><span className="live-dot"></span>{data.liveCount.toLocaleString()}</div>
            <div className="live-stat-label">A-players live now</div>
          </div>
          <div className="live-stat">
            <div className="live-stat-num">100%</div>
            <div className="live-stat-label">Camera-proctored</div>
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
              <div><div className="hc-stat-val">ID ✓</div><div className="hc-stat-lbl">Verified</div></div>
              <div><div className="hc-stat-val">Proctored</div><div className="hc-stat-lbl">Vetting</div></div>
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
        <h2 className="display">Meet a few of<br />our <span className="serif-italic">A-players</span>.</h2>
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
      <h2 className="display">We reject <span className="serif-italic">{data.rejectPct !== null ? data.rejectPct + "%" : "most"}</span><br />of applicants.</h2>
      <p>Every name on the platform cleared three gates &mdash; a camera-proctored English assessment, a proctored skills interview, and a final review before going live. This is the filter we&apos;d want if we were hiring.</p>
    </div>

    <div className="vetting-steps reveal-stagger">
      <div className="vstep">
        <div className="vstep-num">01</div>
        <h3>Proctored English assessment<br />+ skills interview.</h3>
        <p>A written English assessment and a structured skills interview. Every session is camera-proctored, recorded, and integrity-checked &mdash; a proctored exam, end to end.</p>
        <div className="vstep-meta">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          ~90 MIN · INTEGRITY-CHECKED
        </div>
      </div>

      <div className="vstep">
        <div className="vstep-num">02</div>
        <h3>Profile and intro recorded.</h3>
        <p>The candidate verifies their government ID, builds their profile, and records a voice intro. Nothing goes public yet.</p>
        <div className="vstep-meta">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" /></svg>
          ID-VERIFIED
        </div>
      </div>

      <div className="vstep">
        <div className="vstep-num">03</div>
        <h3>Talent Specialist review.</h3>
        <p>A person reviews the full scorecard &mdash; the assessment results, the interview, the profile and intro &mdash; then approves, requests revisions, or rejects. Only then does the profile go live.</p>
        <div className="vstep-meta">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
          ONE COMPREHENSIVE REVIEW
        </div>
      </div>
    </div>

    <div className="vetting-stat reveal">
      <div className="vetting-stat-num">{data.approvalPct !== null ? data.approvalPct + "%" : "…"}</div>
      <div className="vetting-stat-label">
        {data.applications === null
          ? "Approval rate across all applications reviewed."
          : data.liveCount >= 3
            ? "Approval rate. " + data.applications.toLocaleString() + " applications reviewed — " + data.liveCount.toLocaleString() + " live on the platform."
            : data.applications.toLocaleString() + " applications reviewed — the bench is re-verifying under our camera-proctored standard right now."}
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
          <div className="cat-icon">{CAT_ICONS[i % CAT_ICONS.length]}</div>
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

</main>

      <LandingInteractive />
    </div>
  );
}
