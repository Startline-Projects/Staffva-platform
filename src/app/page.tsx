import type { Metadata } from 'next';
import { DM_Sans, DM_Serif_Display } from 'next/font/google';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import styles from './page.module.css';
import FaqAccordion from './_landing/FaqAccordion';
import VoiceMoment from './_landing/VoiceMoment';
import HeroSearch from './_landing/HeroSearch';
import CtaSearch from './_landing/CtaSearch';

export const revalidate = 300;

// ── Fonts ──────────────────────────────────────────────────────────────────
const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const dmSerifDisplay = DM_Serif_Display({
  weight: ['400'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

// ── Metadata ───────────────────────────────────────────────────────────────
export const metadata: Metadata = {
  title: 'Staff VA — Every Candidate Passed Two Interviews',
  description:
    'No scraped profiles. No unvetted résumés. Every professional on StaffVA passed two live interviews and a voice introduction reviewed by our team before you ever see their name.',
  openGraph: {
    title: 'Staff VA — Every Candidate Passed Two Interviews',
    description:
      'No scraped profiles. No unvetted résumés. Every professional on StaffVA passed two live interviews and a voice introduction reviewed by our team before you ever see their name.',
    siteName: 'StaffVA',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

// ── Types ──────────────────────────────────────────────────────────────────
interface LandingCandidate {
  id: string;
  display_name: string | null;
  full_name: string | null;
  country: string | null;
  role_category: string | null;
  hourly_rate: number | null;
  committed_hours: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  skills: any;
  voice_recording_1_url: string | null;
  profile_photo_url: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  '#F4D9B0', '#C8E6C9', '#BBDEFB', '#FFE0B2',
  '#E1BEE7', '#B2DFDB', '#FFCCBC', '#B3E5FC',
];

function getAvatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

function getDisplayName(c: LandingCandidate): string {
  if (c.display_name) return c.display_name;
  if (c.full_name) {
    const parts = c.full_name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
    return parts[0];
  }
  return 'Anonymous';
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function getAvailability(committedHours: number | null): {
  color: string;
  dotBg: string;
  label: string;
} {
  const h = committedHours ?? 0;
  if (h === 0) return { color: '#2e7d32', dotBg: '#4caf50', label: 'Available' };
  if (h < 40)  return { color: '#e65100', dotBg: '#ff9800', label: 'Partially Available' };
  return          { color: '#757575', dotBg: '#9e9e9e', label: 'Unavailable' };
}

function getSkills(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  return (skills as unknown[])
    .filter((s): s is string => typeof s === 'string')
    .slice(0, 3);
}

// ── Page ───────────────────────────────────────────────────────────────────
export default async function Home() {
  const supabase = await createClient();

  const { data } = await supabase
    .from('candidates')
    .select(
      'id, display_name, full_name, country, role_category, hourly_rate, committed_hours, skills, voice_recording_1_url, profile_photo_url'
    )
    .eq('admin_status', 'approved')
    .order('created_at', { ascending: false })
    .limit(6);

  const candidates: LandingCandidate[] = data || [];

  const { data: voiceData } = await supabase
    .from('candidates')
    .select('id, display_name, full_name, role_category, country, profile_photo_url, voice_recording_1_url')
    .eq('admin_status', 'approved')
    .not('voice_recording_1_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(4);

  const voiceCandidates = voiceData || [];

  return (
    <div className={`${styles.landingRoot} ${dmSans.variable} ${dmSerifDisplay.variable}`}>

      {/* ── NAV ── */}
      <nav className="nav">
        <Link href="/" className="nav-logo">
          <svg viewBox="0.00 0.00 300.00 108.00" xmlns="http://www.w3.org/2000/svg" style={{ width: 'auto', height: '32px' }}>
            <path fill="#fe6e3e" d="M 98.04 53.38 A 45.81 45.81 0.0 0 1 52.23 99.19 A 45.81 45.81 0.0 0 1 6.42 53.38 A 45.81 45.81 0.0 0 1 52.23 7.57 A 45.81 45.81 0.0 0 1 98.04 53.38 Z M 52.25 74.60 C 56.26 74.59 58.93 73.05 62.38 70.60 A 2.82 2.67 -70.8 0 1 63.09 70.23 Q 67.42 68.68 71.11 71.37 Q 75.87 74.83 80.32 78.96 A 0.40 0.39 -47.5 0 0 80.88 78.93 C 99.16 58.00 91.03 27.49 65.52 17.43 Q 59.24 14.95 52.14 14.97 Q 45.04 14.98 38.76 17.48 C 13.29 27.63 5.27 58.17 23.63 79.03 A 0.40 0.39 47.3 0 0 24.19 79.06 Q 28.62 74.91 33.37 71.44 Q 37.05 68.73 41.39 70.27 A 2.82 2.67 70.6 0 1 42.10 70.63 C 45.56 73.07 48.23 74.61 52.25 74.60 Z"/>
            <path fill="#fe6e3e" d="M 75.25 44.69 L 76.76 46.21 A 3.07 3.01 -77.6 0 1 77.48 47.36 Q 79.62 53.51 74.45 57.03 C 73.38 57.76 72.07 57.84 70.96 58.18 A 1.31 1.30 6.4 0 0 70.25 58.74 C 62.22 72.13 44.68 72.10 36.67 58.78 A 1.32 1.29 75.1 0 0 35.59 58.14 C 28.19 57.89 24.85 49.92 30.39 44.71 A 1.71 1.70 70.4 0 0 30.91 43.61 C 32.40 24.13 55.96 14.80 69.31 30.42 Q 74.32 36.28 74.84 43.80 A 1.42 1.41 20.4 0 0 75.25 44.69 Z M 52.78 29.17 C 61.38 29.14 67.77 35.88 68.91 44.33 A 0.73 0.72 76.0 0 0 69.87 44.91 L 70.32 44.75 A 1.09 1.09 0.0 0 0 71.03 43.61 C 70.00 34.20 62.21 26.57 52.77 26.60 C 43.33 26.64 35.59 34.33 34.64 43.75 A 1.09 1.09 0.0 0 0 35.36 44.89 L 35.81 45.04 A 0.73 0.72 -76.4 0 0 36.77 44.45 C 37.84 36.00 44.18 29.21 52.78 29.17 Z M 50.14 64.61 Q 59.50 66.20 65.60 58.97 A 0.56 0.56 0.0 0 0 65.25 58.06 Q 64.15 57.92 63.26 58.28 Q 57.42 60.63 51.85 60.31 A 0.48 0.48 0.0 0 0 51.36 60.62 L 49.98 64.34 A 0.21 0.21 0.0 0 0 50.14 64.61 Z"/>
            <path fill="#1c1b1a" d="M 132.15 46.21 A 0.79 0.79 0.0 0 1 130.97 46.59 Q 126.26 43.46 121.11 43.86 C 116.21 44.25 115.14 49.76 119.89 51.35 Q 125.95 53.38 127.18 53.81 C 133.92 56.15 136.28 62.79 133.17 68.99 C 128.99 77.33 115.98 76.13 109.24 71.89 A 0.75 0.74 -63.9 0 1 108.94 71.00 L 110.92 65.66 A 0.65 0.65 0.0 0 1 111.90 65.35 Q 117.12 68.92 123.27 67.85 C 126.70 67.25 128.19 63.29 124.82 61.20 Q 123.12 60.15 116.21 58.08 C 111.13 56.56 108.61 51.69 109.49 46.31 C 111.29 35.29 125.92 35.35 133.33 39.81 A 1.36 1.36 0.0 0 1 133.91 41.46 L 132.15 46.21 Z"/>
            <path fill="#1c1b1a" d="M 201.01 47.61 A 0.42 0.41 0.0 0 1 201.43 48.02 L 201.43 53.14 A 0.46 0.45 0.0 0 1 200.97 53.59 L 195.33 53.59 A 0.49 0.49 0.0 0 0 194.84 54.08 L 194.84 74.00 A 0.61 0.61 0.0 0 1 194.23 74.61 L 188.28 74.61 A 0.68 0.67 -90.0 0 1 187.61 73.93 L 187.61 54.20 A 0.65 0.64 0.0 0 0 186.96 53.56 L 184.48 53.56 A 0.74 0.74 0.0 0 1 183.74 52.82 L 183.74 48.36 A 0.77 0.77 0.0 0 1 184.51 47.59 L 186.63 47.59 A 0.76 0.76 0.0 0 0 187.39 46.77 C 186.63 37.95 193.86 35.89 201.01 37.80 A 0.87 0.87 0.0 0 1 201.66 38.64 L 201.66 43.51 A 0.71 0.70 11.0 0 1 200.69 44.16 Q 195.32 42.01 194.41 46.17 A 1.19 1.18 -83.9 0 0 195.56 47.61 L 201.01 47.61 Z"/>
            <path fill="#1c1b1a" d="M 219.98 43.83 L 215.57 43.83 A 2.04 2.02 -82.0 0 0 213.62 45.31 L 213.41 46.04 A 1.23 1.22 -82.1 0 0 214.58 47.60 L 220.04 47.60 A 0.47 0.47 0.0 0 1 220.51 48.07 L 220.51 53.08 A 0.54 0.53 -0.0 0 1 219.97 53.61 L 214.08 53.61 A 0.49 0.49 0.0 0 0 213.59 54.10 L 213.59 74.03 A 0.59 0.59 0.0 0 1 213.00 74.62 L 206.98 74.62 A 0.59 0.59 0.0 0 1 206.39 74.03 L 206.39 54.19 A 0.62 0.62 0.0 0 0 205.77 53.57 L 203.79 53.57 A 0.70 0.70 0.0 0 1 203.09 52.87 L 203.09 48.19 A 0.61 0.61 0.0 0 1 203.70 47.58 L 205.58 47.58 A 0.57 0.57 0.0 0 0 206.15 46.98 C 205.65 38.05 212.29 36.03 219.69 37.80 A 1.04 1.02 6.8 0 1 220.49 38.80 L 220.49 43.32 A 0.51 0.51 0.0 0 1 219.98 43.83 Z"/>
            <path fill="#1c1b1a" d="M 247.46 65.37 Q 247.69 65.37 247.83 64.93 Q 252.32 51.26 256.88 37.92 A 0.37 0.36 8.6 0 1 257.23 37.67 L 265.25 37.67 A 0.15 0.15 0.0 0 1 265.39 37.87 L 252.02 73.92 A 1.08 1.07 -87.6 0 1 251.30 74.59 Q 251.28 74.59 247.50 74.61 Q 243.72 74.62 243.69 74.61 A 1.08 1.07 87.2 0 1 242.97 73.95 L 229.34 38.00 A 0.15 0.15 0.0 0 1 229.48 37.80 L 237.50 37.74 A 0.37 0.36 -9.0 0 1 237.85 37.99 Q 242.51 51.29 247.09 64.93 Q 247.24 65.37 247.46 65.37 Z"/>
            <path fill="#1c1b1a" d="M 277.01 37.72 Q 279.37 37.71 280.60 37.81 A 0.87 0.87 0.0 0 1 281.36 38.39 L 294.18 73.84 A 0.55 0.55 0.0 0 1 293.67 74.58 L 287.11 74.58 A 0.99 0.99 0.0 0 1 286.18 73.93 L 283.74 67.16 A 0.72 0.72 0.0 0 0 283.07 66.69 Q 282.36 66.68 277.08 66.69 Q 271.80 66.70 271.09 66.72 A 0.72 0.72 0.0 0 0 270.42 67.19 L 268.02 73.98 A 0.99 0.99 0.0 0 1 267.09 74.63 L 260.53 74.66 A 0.55 0.55 0.0 0 1 260.02 73.93 L 272.66 38.41 A 0.87 0.87 0.0 0 1 273.41 37.83 Q 274.65 37.72 277.01 37.72 Z M 272.68 60.03 A 0.31 0.31 0.0 0 0 272.97 60.44 L 281.13 60.45 A 0.31 0.31 0.0 0 0 281.43 60.05 L 277.37 47.28 A 0.31 0.31 0.0 0 0 276.78 47.28 L 272.68 60.03 Z"/>
            <path fill="#1c1b1a" d="M 153.86 68.09 L 155.59 72.87 A 0.58 0.58 0.0 0 1 155.31 73.58 C 148.12 77.17 140.04 74.87 140.15 65.73 Q 140.26 56.43 140.19 54.11 A 0.56 0.56 0.0 0 0 139.63 53.57 L 136.97 53.57 A 0.84 0.83 90.0 0 1 136.14 52.73 L 136.14 48.31 A 0.73 0.73 0.0 0 1 136.87 47.58 L 139.26 47.58 A 0.59 0.58 -90.0 0 0 139.84 46.99 L 139.84 41.29 A 0.94 0.93 -0.0 0 1 140.78 40.36 L 146.46 40.36 A 0.95 0.95 0.0 0 1 147.41 41.31 L 147.41 46.67 A 0.92 0.92 0.0 0 0 148.33 47.59 L 153.53 47.59 A 0.86 0.86 0.0 0 1 154.39 48.45 L 154.39 52.78 A 0.82 0.81 -90.0 0 1 153.58 53.60 L 147.97 53.60 A 0.55 0.54 -0.5 0 0 147.42 54.15 Q 147.43 60.22 147.39 62.87 C 147.34 67.09 148.79 69.96 153.41 67.90 A 0.34 0.33 -21.5 0 1 153.86 68.09 Z"/>
            <path fill="#1c1b1a" d="M 174.18 72.32 A 0.31 0.31 0.0 0 0 173.64 72.11 C 168.34 77.81 156.87 75.62 157.64 66.32 C 158.22 59.32 165.85 58.04 171.72 57.95 A 1.79 1.79 0.0 0 0 173.35 55.49 L 173.33 55.46 A 4.32 4.32 0.0 0 0 169.42 52.77 Q 164.75 52.67 161.14 54.93 A 0.85 0.84 63.8 0 1 159.90 54.50 L 158.64 51.00 A 1.21 1.20 64.3 0 1 159.13 49.57 Q 165.33 45.68 172.72 46.89 C 177.44 47.65 180.50 50.92 180.60 55.43 Q 180.73 61.75 180.66 73.99 A 0.63 0.62 -0.0 0 1 180.03 74.61 L 174.90 74.61 A 0.72 0.72 0.0 0 1 174.18 73.89 L 174.18 72.32 Z M 173.03 62.73 L 167.63 63.56 A 2.91 2.90 -9.8 0 0 165.22 66.98 L 165.27 67.22 A 2.91 2.90 -11.1 0 0 168.59 69.45 Q 174.13 68.50 173.39 63.00 A 0.31 0.31 0.0 0 0 173.03 62.73 Z"/>
          </svg>
        </Link>

        <div className="nav-links">
          <Link href="#">Hire Staff</Link>
          <Link href="#">Services</Link>
          <Link href="/login">Find Work</Link>
          <Link href="#">How It Works</Link>
        </div>

        <div className="nav-actions">
          <Link href="/login" className="btn-signin">Sign In</Link>
          <Link href="/login" className="btn-get-started">Get Started</Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="hero">
        <div className="hero-content">
          <div className="hero-badge">
            <span className="dot"></span>
            Every candidate. Two interviews. Zero exceptions.
          </div>

          <h1 className="hero-headline">
            Every candidate passed<br /><em>two interviews to be here.</em>
          </h1>

          <p className="hero-sub">
            No scraped profiles. No unvetted résumés. Every professional on StaffVA passed two live
            interviews and a voice introduction reviewed by our team before you ever see their name.
          </p>

          <HeroSearch />

          <div className="trust-line">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            Free to browse · Escrow-protected payments · Only pre-vetted talent
          </div>
        </div>

        <div className="stats-bar">
          <div className="stat"><div className="stat-number">2</div><div className="stat-label">Live Interviews</div></div>
          <div className="stat"><div className="stat-number">&lt;30%</div><div className="stat-label">Pass Rate</div></div>
          <div className="stat"><div className="stat-number">100%</div><div className="stat-label">Human Reviewed</div></div>
          <div className="stat"><div className="stat-number">10+</div><div className="stat-label">Countries</div></div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="how-it-works">
        <div className="hiw-container">
          <div className="hiw-header">
            <span className="section-tag">How it works</span>
            <h2 className="section-headline">From search to hire<br /><em>in minutes.</em></h2>
            <p className="section-sub">No login required. No subscription. Browse talent the moment you arrive.</p>
          </div>
          <div className="hiw-steps">
            <div className="hiw-step">
              <div className="hiw-step-number">01</div>
              <div className="hiw-step-icon">
                <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="20" cy="20" r="12" stroke="currentColor" strokeWidth={2.5}/>
                  <line x1="28.5" y1="28.5" x2="38" y2="38" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"/>
                  <circle cx="20" cy="20" r="5" stroke="currentColor" strokeWidth={1.5} strokeDasharray="3 2"/>
                </svg>
              </div>
              <h3 className="hiw-step-title">Browse instantly</h3>
              <p className="hiw-step-desc">No login. No subscription. Profiles load the moment you arrive — rates, skills, and availability, all visible upfront.</p>
            </div>
            <div className="hiw-connector">
              <svg viewBox="0 0 80 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <line x1="0" y1="10" x2="60" y2="10" stroke="currentColor" strokeWidth={1.5} strokeDasharray="6 4"/>
                <polyline points="58,5 66,10 58,15" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="hiw-step">
              <div className="hiw-step-number">02</div>
              <div className="hiw-step-icon">
                <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="8" y="12" width="32" height="24" rx="4" stroke="currentColor" strokeWidth={2.5}/>
                  <path d="M16 22 C16 22 20 26 24 26 C28 26 32 22 32 22" stroke="currentColor" strokeWidth={2} strokeLinecap="round"/>
                  <circle cx="17" cy="28" r="2" fill="currentColor" opacity="0.3"/>
                  <circle cx="22" cy="30" r="1.5" fill="currentColor" opacity="0.2"/>
                  <circle cx="27" cy="29" r="2.5" fill="currentColor" opacity="0.25"/>
                  <circle cx="32" cy="28" r="1.5" fill="currentColor" opacity="0.15"/>
                </svg>
              </div>
              <h3 className="hiw-step-title">View, listen, then decide</h3>
              <p className="hiw-step-desc">Every profile comes with a voice recording and video intro. See their work, hear their English, watch them speak — before you ever reach out.</p>
            </div>
            <div className="hiw-connector">
              <svg viewBox="0 0 80 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <line x1="0" y1="10" x2="60" y2="10" stroke="currentColor" strokeWidth={1.5} strokeDasharray="6 4"/>
                <polyline points="58,5 66,10 58,15" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="hiw-step">
              <div className="hiw-step-number">03</div>
              <div className="hiw-step-icon">
                <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="10" y="8" width="28" height="32" rx="3" stroke="currentColor" strokeWidth={2.5}/>
                  <path d="M18 22 L22 26 L30 18" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="16" y1="32" x2="32" y2="32" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" opacity="0.4"/>
                  <line x1="16" y1="36" x2="26" y2="36" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" opacity="0.25"/>
                </svg>
              </div>
              <h3 className="hiw-step-title">Pay through escrow</h3>
              <p className="hiw-step-desc">Funds are held until you approve the work. Protected on both sides. No surprises, no chasing invoices.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── LIVE TALENT GRID ── */}
      <section className="talent-section">
        <div className="talent-container">
          <div className="talent-header">
            <span className="section-tag">Available now</span>
            <h2 className="section-headline">Who&apos;s available<br /><em>right now.</em></h2>
            <p className="section-sub">Real professionals. Real rates. Ready to start today.</p>
          </div>

          <div className="talent-grid">
            {candidates.length === 0 ? (
              <div className="talent-empty" style={{ gridColumn: '1 / -1' }}>
                New talent is being vetted right now. Check back soon.
              </div>
            ) : (
              candidates.map((c, idx) => {
                const name = getDisplayName(c);
                const initials = getInitials(name);
                const avail = getAvailability(c.committed_hours);
                const skills = getSkills(c.skills);
                const hasVoice = !!c.voice_recording_1_url;

                return (
                  <Link href={`/candidate/${c.id}`} className="talent-card" key={c.id} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                    <div className="talent-card-top">
                      {c.profile_photo_url ? (
                        <img
                          src={c.profile_photo_url}
                          alt={name}
                          className="talent-avatar"
                          style={{ objectFit: 'cover' }}
                        />
                      ) : (
                        <div className="talent-avatar" style={{ background: getAvatarColor(idx) }}>
                          <span>{initials}</span>
                        </div>
                      )}
                      <div className="talent-availability" style={{ color: avail.color }}>
                        <span className="avail-dot" style={{ background: avail.dotBg }}></span>
                        {avail.label}
                      </div>
                    </div>
                    <div className="talent-info">
                      <div className="talent-name-row">
                        <h4 className="talent-name">{name}</h4>
                        {c.hourly_rate != null && (
                          <span className="talent-rate">
                            ${c.hourly_rate.toLocaleString()}<small>/hr</small>
                          </span>
                        )}
                      </div>
                      {c.role_category && <p className="talent-role">{c.role_category}</p>}
                      {c.country && <p className="talent-location">{c.country}</p>}
                      {skills.length > 0 && (
                        <div className="talent-tags">
                          {skills.map((s) => (
                            <span className="talent-tag" key={s}>{s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="talent-card-footer">
                      <div className="talent-media-icons">
                        {hasVoice && (
                          <div className="media-badge" title="Voice recording">
                            <svg viewBox="0 0 20 20" fill="none">
                              <path d="M10 2a3 3 0 00-3 3v5a3 3 0 006 0V5a3 3 0 00-3-3z" stroke="currentColor" strokeWidth={1.5}/>
                              <path d="M5 10a5 5 0 0010 0" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"/>
                              <line x1="10" y1="15" x2="10" y2="18" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"/>
                            </svg>
                          </div>
                        )}
                        <div className="media-badge" title="Video intro">
                          <svg viewBox="0 0 20 20" fill="none">
                            <rect x="2" y="4" width="11" height="12" rx="2" stroke="currentColor" strokeWidth={1.5}/>
                            <path d="M13 8l5-3v10l-5-3V8z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </div>
                      <span className="talent-view">View →</span>
                    </div>
                  </Link>
                );
              })
            )}
          </div>

          <div className="talent-cta">
            <a href="/browse" className="btn-see-all">
              See all talent
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <line x1="4" y1="10" x2="16" y2="10"/><polyline points="11,5 16,10 11,15"/>
              </svg>
            </a>
          </div>
        </div>
      </section>

      {/* ── VETTING STORY ── */}
      <section className="vetting-section">
        <div className="vetting-container">
          <div className="vetting-header">
            <span className="section-tag">Why StaffVA</span>
            <h2 className="section-headline">Trust is built in.<br /><em>Not bolted on.</em></h2>
            <p className="section-sub">Every professional on this platform passed a vetting process most platforms don&apos;t even attempt.</p>
          </div>

          <div className="vetting-timeline">
            <div className="vetting-stage">
              <div className="vetting-stage-line">
                <div className="vetting-stage-dot"></div>
                <div className="vetting-stage-connector"></div>
              </div>
              <div className="vetting-stage-content">
                <div className="vetting-stage-badge">Interview 1</div>
                <h3 className="vetting-stage-title">Skills &amp; experience assessment</h3>
                <p className="vetting-stage-desc">A live interview with our team evaluating role-specific knowledge, tool proficiency, and professional experience. We ask real questions — not checkbox quizzes.</p>
                <div className="vetting-proof-points">
                  {['Role-specific scenario questions', 'Tool & software proficiency check', 'Work history verified by a human'].map((pt) => (
                    <div className="proof-point" key={pt}>
                      <svg viewBox="0 0 20 20" fill="none"><path d="M5 10l3 3 7-7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span>{pt}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="vetting-stage">
              <div className="vetting-stage-line">
                <div className="vetting-stage-dot"></div>
                <div className="vetting-stage-connector"></div>
              </div>
              <div className="vetting-stage-content">
                <div className="vetting-stage-badge">Interview 2</div>
                <h3 className="vetting-stage-title">Spoken English &amp; communication</h3>
                <p className="vetting-stage-desc">A second live interview focused entirely on spoken English. We test clarity, comprehension, and confidence — then record a voice sample and video intro so clients can judge for themselves.</p>
                <div className="vetting-proof-points">
                  {['Live conversational English test', 'Voice recording captured on the spot', 'Video intro filmed and reviewed'].map((pt) => (
                    <div className="proof-point" key={pt}>
                      <svg viewBox="0 0 20 20" fill="none"><path d="M5 10l3 3 7-7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span>{pt}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="vetting-stage">
              <div className="vetting-stage-line">
                <div className="vetting-stage-dot dot-final"></div>
              </div>
              <div className="vetting-stage-content">
                <div className="vetting-stage-badge badge-final">Approved</div>
                <h3 className="vetting-stage-title">Profile goes live</h3>
                <p className="vetting-stage-desc">Less than 30% make it through. Those who do get a verified badge, a published profile, and access to clients — permanently. The candidate never touches the badge.</p>
              </div>
            </div>
          </div>

          <div className="vetting-stats">
            <div className="vetting-stat">
              <div className="vetting-stat-icon">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <h4 className="vetting-stat-title">Badges that can&apos;t be faked</h4>
              <p className="vetting-stat-desc">English tier is assigned by our team after the written assessment. The voice introduction is recorded live and reviewed by a human. Both are locked. The candidate never touches them.</p>
            </div>
            <div className="vetting-stat">
              <div className="vetting-stat-icon">
                <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth={2}/><line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth={2}/><circle cx="7.5" cy="14.5" r="1.5" fill="currentColor"/></svg>
              </div>
              <h4 className="vetting-stat-title">One identity per person</h4>
              <p className="vetting-stat-desc">Government ID verification through Stripe Identity. Duplicate accounts are detected and blocked automatically.</p>
            </div>
            <div className="vetting-stat">
              <div className="vetting-stat-icon">
                <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2}/><path d="M12 6v6l4 2" stroke="currentColor" strokeWidth={2} strokeLinecap="round"/></svg>
              </div>
              <h4 className="vetting-stat-title">Candidates earn 100%</h4>
              <p className="vetting-stat-desc">We never take a cut from the professional. Professionals receive 100% of their stated rate. That&apos;s why talent stays.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── VOICE MOMENT (client component) ── */}
      <VoiceMoment candidates={voiceCandidates} />

      {/* ── PAYMENT SECTION ── */}
      <section className="payment-section">
        <div className="payment-container">
          <div className="payment-header">
            <span className="section-tag">How payment works</span>
            <h2 className="section-headline">Your money doesn&apos;t move<br /><em>until you say so.</em></h2>
            <p className="section-sub">Every dollar sits in escrow. Work happens. You release payment when you&apos;re ready — not a moment before.</p>
          </div>

          <div className="payment-snapshot">
            <div className="payment-snapshot-header">
              <span className="payment-snapshot-label">Payment preview</span>
              <span className="payment-snapshot-status">
                <svg className="lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
                </svg>
                Escrow protected
              </span>
            </div>
            <div className="payment-snapshot-body">
              <div className="payment-row"><span className="payment-row-label">Professional</span><span className="payment-row-value">Yasmin N. · Executive Assistant</span></div>
              <div className="payment-row"><span className="payment-row-label">Weekly rate</span><span className="payment-row-value">$320.00</span></div>
              <div className="payment-row"><span className="payment-row-label">Billing cycle</span><span className="payment-row-value">Weekly</span></div>
              <div className="payment-total-row">
                <span className="payment-total-label">Total due today</span>
                <span className="payment-total-value">$352.00</span>
              </div>
            </div>
            <div className="payment-snapshot-footer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              Your payment is held in escrow until you approve.
            </div>
          </div>

          <div className="payment-flow">
            <span className="payment-flow-dot" aria-hidden="true"></span>
            {[
              {
                num: 'Step 1', title: 'Fund', desc: 'You fund the cycle before work begins. Payment is captured and held — not sent to the professional yet.', note: 'Secured by Stripe',
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/></svg>
              },
              {
                num: 'Step 2', title: 'Work happens', desc: 'Your professional delivers the work — answering emails, updating books, managing projects, whatever you hired them for.', note: 'Funds stay locked',
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg>
              },
              {
                num: 'Step 3', title: 'Release', desc: 'When the cycle completes, funds auto-release to the professional. Not happy? A 48-hour dispute window is built in.', note: '48-hour dispute window',
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4L19 6"/><circle cx="12" cy="12" r="10" opacity="0.4"/></svg>
              },
            ].map((step) => (
              <div className="payment-step" key={step.num}>
                <div className="payment-step-icon">{step.icon}</div>
                <span className="payment-step-number">{step.num}</span>
                <h3 className="payment-step-title">{step.title}</h3>
                <p className="payment-step-desc">{step.desc}</p>
                <div className="payment-step-footnote">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>
                  {step.note}
                </div>
              </div>
            ))}
          </div>

          <div className="payment-trust">
            {[
              { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>, text: 'Stripe escrow on every engagement' },
              { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>, text: 'Dispute team on standby' },
              { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>, text: 'Cancel anytime — no contracts' },
            ].map((item) => (
              <div className="payment-trust-item" key={item.text}>{item.icon}{item.text}</div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="testimonials">
        <div className="testimonials-container">
          <div className="testimonials-header">
            <span className="section-tag">Real stories</span>
            <h2 className="section-headline">The proof is in<br /><em>the people you hire.</em></h2>
            <p className="section-sub">Every quote below is from a verified hire. No incentives, no curation — just what founders actually said after their first 30 days.</p>
          </div>

          <div className="testimonial-featured">
            <div className="testimonial-featured-content">
              <div className="testimonial-featured-quote-mark">&ldquo;</div>
              <blockquote className="testimonial-featured-quote">
                I&apos;d tried three other platforms. Spent weeks vetting. On StaffVA I listened to four voice
                samples, hired one, and had my inbox cleared by <em>end of week one.</em>
              </blockquote>
              <div className="testimonial-featured-attribution">
                <div className="testimonial-avatar"><span>DK</span></div>
                <div className="testimonial-author">
                  <div className="testimonial-author-name">Daniel K.</div>
                  <div className="testimonial-author-title">Founder · E-commerce operator</div>
                  <div className="testimonial-verified">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>
                    Verified hire
                  </div>
                </div>
              </div>
            </div>
            <div className="testimonial-outcome">
              <div className="testimonial-outcome-label">Outcome</div>
              <div className="testimonial-outcome-metric">15 <em>hrs</em></div>
              <p className="testimonial-outcome-desc">Saved per week on email, scheduling, and inbox triage within the first 30 days.</p>
              <div className="testimonial-outcome-divider"></div>
              <div className="testimonial-outcome-meta">
                <span>Hired in <strong>3 days</strong></span>
                <span>Role: <strong>Executive Assistant</strong></span>
              </div>
            </div>
          </div>

          <div className="testimonials-small-grid">
            {[
              { tag: 'Hired a bookkeeper', quote: 'The voice samples changed everything. I knew which three to interview before I\'d read a single résumé.', avatar: 'a-b', initials: 'RM', name: 'Rachel M.', role: 'Agency owner', outcome: 'Hired in 2 days' },
              { tag: 'Hired a paralegal', quote: 'Escrow was the reason I tried it. The quality of the professional was the reason I stayed.', avatar: 'a-c', initials: 'TC', name: 'Tomás C.', role: 'Solo operator', outcome: '6 months in' },
              { tag: 'Hired a social media manager', quote: 'Every other platform felt like a gamble. This one felt like hiring someone from a referral.', avatar: 'a-d', initials: 'JL', name: 'Jenna L.', role: 'Boutique consultancy', outcome: 'Rehired twice' },
            ].map((t) => (
              <div className="testimonial-small" key={t.name}>
                <span className="testimonial-small-tag">{t.tag}</span>
                <blockquote className="testimonial-small-quote">&ldquo;{t.quote}&rdquo;</blockquote>
                <div className="testimonial-small-attribution">
                  <div className={`testimonial-avatar ${t.avatar}`}><span>{t.initials}</span></div>
                  <div className="testimonial-small-meta">
                    <div className="testimonial-small-name">{t.name}</div>
                    <div className="testimonial-small-role">{t.role}</div>
                  </div>
                  <span className="testimonial-small-outcome">{t.outcome}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="faq-section">
        <div className="faq-container">
          <aside className="faq-header">
            <span className="section-tag">Common questions</span>
            <h2 className="faq-headline">Questions business<br />owners ask<br /><em>before they hire.</em></h2>
            <p className="faq-header-sub">If you&apos;re weighing StaffVA for the first time, this is probably what&apos;s on your mind.</p>
            <div className="faq-support-card">
              <div className="faq-support-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6h16v12H4z"/><path d="M4 6l8 7 8-7"/>
                </svg>
              </div>
              <div className="faq-support-title">Still have a question?</div>
              <p className="faq-support-desc">Our team replies within one business day.</p>
              <a href="mailto:hello@staffva.com" className="faq-support-link">
                Email our team
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                </svg>
              </a>
            </div>
          </aside>
          {/* FAQ accordion — client component */}
          <FaqAccordion />
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="final-cta">
        <div className="final-cta-container">
          <div className="final-cta-tag">
            <span className="dot"></span>
            Vetted talent, available today
          </div>
          <h2 className="final-cta-headline">
            Your next hire<br /><em>is already waiting.</em>
          </h2>
          <p className="final-cta-sub">
            No login required to browse. No subscription. No candidate fees. Search a role, listen to a voice sample, message for free — and hire when you&apos;re ready.
          </p>
          <CtaSearch />
          <div className="final-cta-trust-row">
            <div className="final-cta-trust-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>
              Two live interviews per candidate
            </div>
            <div className="final-cta-trust-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Escrow-protected payments
            </div>
            <div className="final-cta-trust-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20"/><path d="M12 2a15 15 0 0 0 0 20"/></svg>
              Talent from 10+ countries
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="footer">
        <div className="footer-container">
          <div className="footer-grid">
            <div className="footer-brand">
              <a href="/" className="footer-logo">
                StaffVA<span className="footer-logo-dot"></span>
              </a>
              <p className="footer-tagline">
                The offshore talent marketplace where every candidate passed two interviews before you ever see their name.
              </p>
              <div className="footer-socials">
                <a href="#" className="footer-social" aria-label="LinkedIn">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
                </a>
                <a href="#" className="footer-social" aria-label="X (Twitter)">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </a>
                <a href="#" className="footer-social" aria-label="TikTok">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.54a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.01z"/></svg>
                </a>
                <a href="#" className="footer-social" aria-label="Instagram">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.849.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.849.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                </a>
              </div>
            </div>

            <div className="footer-col">
              <div className="footer-col-title">Platform</div>
              <ul className="footer-col-links">
                <li><a href="#">Browse talent</a></li>
                <li><a href="#">How it works</a></li>
                <li><a href="#">Pricing</a></li>
                <li><a href="#">Vetting process</a></li>
                <li><a href="#">Dispute protection</a></li>
              </ul>
            </div>

            <div className="footer-col">
              <div className="footer-col-title">For Professionals</div>
              <ul className="footer-col-links">
                <li><a href="#">Apply to join</a></li>
                <li><a href="#">How vetting works</a></li>
                <li><a href="#">Keep 100% of your rate</a></li>
                <li><a href="#">Sign in</a></li>
              </ul>
            </div>

            <div className="footer-col">
              <div className="footer-col-title">Company</div>
              <ul className="footer-col-links">
                <li><a href="#">About</a></li>
                <li><a href="#">Careers</a></li>
                <li><a href="mailto:hello@staffva.com">Contact</a></li>
                <li><a href="#">Press</a></li>
              </ul>
            </div>

            <div className="footer-col">
              <div className="footer-col-title">Legal</div>
              <ul className="footer-col-links">
                <li><a href="#">Terms of service</a></li>
                <li><a href="#">Privacy policy</a></li>
                <li><a href="#">Cookie policy</a></li>
                <li><a href="#">Acceptable use</a></li>
              </ul>
            </div>
          </div>

          <div className="footer-bottom">
            <div className="footer-copyright">
              &copy; 2026 <strong>Stafva LLC</strong> &middot; Dearborn, Michigan &middot; All rights reserved.
            </div>
            <div className="footer-meta">
              <a href="#">Terms</a>
              <a href="#">Privacy</a>
              <a href="#">Cookies</a>
              <a href="mailto:hello@staffva.com">hello@staffva.com</a>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
