# Staffva Platform — CLAUDE.md

## What This Project Is

A global staffing/talent marketplace connecting clients (hiring managers) with pre-vetted VA candidates. Candidates go through a multi-gate application pipeline (English test, voice recording, ID verification, admin approval) before they appear in the browse marketplace. Clients can post jobs, browse candidates, send offers, sign contracts, and manage payments through escrow.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.1 (App Router, Turbopack dev) |
| UI | React 19.2.4 (Server + Client Components) |
| Language | TypeScript 5.9.3 (strict mode, path alias `@/*` → `./src/*`) |
| Database & Auth | Supabase (`@supabase/supabase-js` 2.99.3, `@supabase/ssr` 0.9.0) |
| Payments | Stripe 20.4.1 (Connect + escrow) |
| Email | Resend 6.9.4 |
| Styling | Tailwind CSS v4 via `@tailwindcss/postcss`, Google Fonts (DM Sans, DM Serif Display, DM Mono) |
| Charts | Recharts 3.8.1 |
| PDF generation | Puppeteer Core 24.40.0 + `@sparticuz/chromium` 143.0.4 (serverless) |
| Scheduling | Vercel Crons (13 jobs, defined in `vercel.json`) |
| JWT | `jose` 6.2.2 |

**Dev commands:**
```
npm run dev      # Turbopack dev server
npm run build    # Production build
npm run lint     # ESLint
```

---

## Folder Structure

```
src/
├── app/
│   ├── (admin)/          # Admin-only route group (role-gated in layout)
│   ├── (main)/           # Protected app routes (apply, browse, hire, contracts…)
│   ├── _landing/         # Non-routable landing page component parts
│   ├── api/              # 185 API route handlers
│   ├── auth/             # Magic link callbacks + signout endpoint
│   ├── globals.css       # Tailwind v4 theme + custom tokens
│   ├── layout.tsx        # Root layout
│   └── page.tsx          # Public landing page (ISR 300s)
├── components/
│   ├── admin/            # Sidebar, topbar, candidate preview, screening queue
│   ├── apply/            # 14-component multi-step application flow
│   ├── browse/           # Candidate cards, preview panel, audio preview
│   ├── inbox/            # Messaging thread UI
│   ├── landing/          # Landing page sections
│   ├── recruiter/        # Recruiter dashboard (KPI strip, lanes, chat)
│   ├── recruiting-manager/ # Approve/ban buttons
│   └── [root]            # Navbar, AudioPlayer, EscrowStatusPanel, modals…
├── lib/
│   ├── supabase/         # server.ts, client.ts, middleware.ts
│   ├── types/
│   │   └── database.ts   # All TypeScript DB types and enums
│   ├── auth.ts           # getUser, getUserRole, requireAuth, requireRole
│   ├── approvalGates.ts  # 11-gate candidate quality checklist
│   ├── contracts.ts      # HMAC signing tokens + Claude API contract generation
│   ├── google-calendar.ts # Google OAuth, calendar webhooks, token refresh
│   ├── audioUtils.ts     # Voice recording utilities
│   ├── testProgress.ts   # English test state machine
│   ├── recruiterScope.ts # Limit recruiter to assigned candidates only
│   ├── uploadQueue.ts    # Supabase Storage with 3-retry/10s backoff
│   └── generateInsights.ts # AI candidate profile insights
└── middleware.ts          # Session refresh on all non-API routes
```

---

## Authentication & Roles

**Auth library:** Supabase Auth (JWT, cookie-based via `@supabase/ssr`).  
**Logout endpoint:** `POST /auth/signout` → calls `supabase.auth.signOut()` → redirects to `/login`.

### User Roles

| Role | Access |
|---|---|
| `candidate` | Apply, view own profile, inbox, offers |
| `client` | Browse candidates, post jobs, hire, escrow |
| `admin` | Full admin panel (`/admin/*`) |
| `recruiter` | Recruiter dashboard, scoped candidate queue |
| `recruiting_manager` | Subset of admin panel, approve/ban candidates |

**Role check pattern (server component / API route):**
```ts
import { getUser, requireRole } from "@/lib/auth";
const user = await getUser();           // null if unauthenticated
await requireRole("admin");             // throws redirect if wrong role
```

**Middleware** (`src/middleware.ts`): refreshes tokens on every non-API page route. Protected routes: `/apply`, `/inbox`, `/admin/*`, `/team`, `/hire/*`, `/candidate/dashboard`.

---

## Database (Supabase)

All types live in `src/lib/types/database.ts`.

### Migration naming — READ THIS BEFORE ADDING ONE

**New migrations take a UTC timestamp prefix, never the next integer:**

```
20260908100300_client_shortlists.sql        ✅
00234_client_shortlists.sql                 ❌
```

Get the prefix from `date -u +%Y%m%d%H%M%S`. Because `"0" < "2"`, every
timestamped file sorts after every legacy `000NN` one, so the existing apply
order is preserved and you never have to reason about it.

Why: more than one agent works this repo at once, and the sequential scheme
made them collide constantly — `00220`, `00221`, `00222`, `00223` and `00224`
each ended up with two different files, because both sessions derived "the
next number" from the same `ls`. Duplicate version prefixes leave the apply
order undefined. Timestamps make a collision require two authors in the same
second.

**Do not renumber the legacy `000NN` files.** Several are already applied, and
Supabase tracks applied migrations by version string — renaming an applied one
makes the CLI treat it as new and re-run it.

**Refer to a migration by NAME in code comments**, not by number:

```ts
// The verification columns arrive in migration `client_verification`.   ✅
// The verification columns arrive in migration 00231.                   ❌
```

A number in a comment goes stale the moment anything is renumbered; the name
does not.

### Working alongside another agent in this repo

Two Claude sessions frequently run here at once. Three rules:

1. **Never `git add -A` or `git add -u`.** Stage explicit paths. A blanket add
   sweeps the other session's in-progress files into your commit — this has
   already happened four times.
2. **Check `git log --oneline -1` before committing.** HEAD moves under you.
3. **Prefer a worktree** for any multi-step piece of work:
   `git worktree add ../staffva-<lane> -b feature/<lane>`. Separate directory,
   separate index — the other session's files become invisible to your `git
   add`, and its `git push` cannot carry your commits to `origin/main`.

### Core Tables

| Table | Purpose |
|---|---|
| `profiles` | Auth user metadata — id, role, email, full_name |
| `candidates` | Full candidate profile (150+ columns) |
| `clients` | Hiring manager accounts |
| `engagements` | Active client↔candidate work relationships |
| `milestones` | Project-based escrow steps |
| `payment_periods` | Recurring (weekly/biweekly/monthly) payments |
| `contracts` | Claude-generated legal documents |
| `offers` | Job offers with expiry |
| `jobs` | Posted roles |
| `disputes` | Payment disputes + resolution decisions |
| `reviews` | 5-star ratings (eligible 7+ days in) |
| `messages` | Client↔candidate chat threads |
| `screening_queue` | Admin interview scheduling |
| `identity_sessions` | Third-party ID verification sessions |
| `notification_subscriptions` | Email preference tracking |

### Key Enums (from `database.ts`)

```ts
UserRole:             candidate | client | admin | recruiter | recruiting_manager
AdminStatus:          active | pending_2nd_interview | pending_review | profile_review | approved | rejected
AvailabilityStatus:   available_now | available_by_date | not_available
SpeakingLevel:        basic | conversational | proficient | fluent
EnglishWrittenTier:   exceptional | proficient | competent
ContractType:         ongoing | project
PaymentCycle:         weekly | biweekly | monthly
MilestoneStatus:      pending | funded | candidate_marked_complete | approved | disputed | released | refunded
DisputeDecision:      full_client_refund | full_candidate_release | split_50_50 | pro_rata | fraud_ban
IDVerificationStatus: pending | passed | failed | manual_review
```

---

## API Routes (140+)

All routes live under `src/app/api/`. Key groups:

| Prefix | Routes | Purpose |
|---|---|---|
| `/api/admin/*` | 27 | Candidate mgmt, reviews, lockouts, disputes, settings, command-center |
| `/api/auth/*` | 6 | Email verification, OTP resend |
| `/api/candidates/*` | 4 | Search, preview, autocomplete |
| `/api/candidate/*` | 17 | Profile updates, rerecord, photo, role classification |
| `/api/contracts/*` | 5 | Generate (Claude API), PDF (Puppeteer), sign, list, view |
| `/api/engagements/*` | 8 | Create, invite, milestones, periods, escrow release |
| `/api/escrow/*` | 4 | Fund, release, auto-release, status |
| `/api/disputes/*` | 3 | File, list, resolve |
| `/api/stripe/*` | 3 | Webhook, Connect accounts (checkout + portal retired with the subscription) |
| `/api/services/*` | 6 | 404 tombstones — the services/giveaway surface is retired (pages deleted in client step 1) |
| `/api/recruiter/*` | 15 | Queue, approvals, notes, Google Calendar OAuth, reminders |
| `/api/recruiting-manager/*` | 4 | Dashboard, approve, ban, notifications |
| `/api/test/*` | 6 | Questions, submit, anti-cheat check/log, lockout |
| `/api/identity/*` | 3 | Create session, webhook, status check |
| `/api/cron/*` | 20 | All scheduled background jobs |
| `/api/messages/*` | 2 | Send, thread retrieval |
| `/api/match/*` | 1 | AI candidate matching |
| `/api/reviews/*` | 2 | Publish review |
| `/api/notifications/*` | 2 | Slack + availability alerts |

---

## Styling

- **Tailwind CSS v4** — utility classes everywhere except admin components (which use inline `style={{}}` props).
- **Custom theme tokens** (in `globals.css` `@theme` block):
  - Primary orange: `#FE6E3E` / dark `#E55A2B`
  - Background: `#FAFAFA`, Card: `#FFFFFF`, Warm surface: `#F8F6F2`
  - Text: `#1C1B1A` (dark), `#5A5550` (secondary), `#9A9590` (tertiary)
  - Border: `#E4E0D8`
  - Admin sidebar bg: `#1C1B1A`
- **Fonts:** DM Sans (body), DM Serif Display (headings), DM Mono (admin/code)
- **Animations:** `fade-in-up` (0.6s ease-out), `waveform` (audio bars)
- **CSS Modules:** `src/app/page.module.css` for landing page only.

---

## Candidate Approval Pipeline (11 Gates)

Defined in `src/lib/approvalGates.ts`. A candidate must pass all 11 before going live:

1. English multiple-choice score ≥ threshold
2. English comprehension score ≥ threshold
3. Speaking level ≥ `conversational`
4. Written tier ≥ `competent`
5. Voice recording 1 uploaded
6. Voice recording 2 uploaded
7. ID verification `passed`
8. Resume uploaded
9. Bio filled in
10. Payout method set
11. Integrity consent signed

---

## Vercel Cron Jobs

Defined in `vercel.json` (21 entries as of 2026-09-12). Routes live under
`src/app/api/cron/`. The table below is a selection, not the full list — `vercel.json` is authoritative.

| Schedule | Job |
|---|---|
| `* * * * *` | Application queue processor |
| `*/5 * * * *` | Screening queue processor |
| `*/15 * * * *` | Stripe webhook reconciliation |
| `0 * * * *` | AI interview retake notifications |
| `0 */6 * * *` | Interview nudge emails |
| `0 8 * * *` | SLA alerts |
| `0 9 * * 1` | Weekly digest email (Monday) |
| `0 9 * * *` | Renew Google Calendar watches |
| `0 10 * * *` | Availability nudge |
| `0 11 * * *` | ID verification alerts |
| `0 12 * * *` | Expire stale offers |
| `0 14 * * *` | Stage nudge email |

---

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # Server-only — never expose to client

# Stripe
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# Email
RESEND_API_KEY=

# App
NEXT_PUBLIC_APP_URL=                 # Used for absolute links and OAuth redirects

# Google Calendar
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Contract generation
CONTRACT_SIGNING_SECRET=            # HMAC key for signing tokens (7-day expiry)
CLAUDE_API_KEY=                     # Claude API for contract + insights generation
```

---

## Patterns & Conventions

### Server vs Client Components
- Default to **Server Components**. Add `"use client"` only when you need hooks, event handlers, or browser APIs.
- Admin components (`AdminSidebar`, `AdminTopbar`) are client components due to `usePathname`, hover state, etc.

### Supabase Client Selection
```ts
// Server component or API route:
import { createClient } from "@/lib/supabase/server";
const supabase = await createClient();

// Client component:
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();
```

### Auth Guard in API Routes
```ts
import { requireAuth, requireRole } from "@/lib/auth";
await requireAuth();         // 401 if not logged in
await requireRole("admin");  // 403 if wrong role
```

### Auth Guard in Admin Layout
The `(admin)/layout.tsx` does a server-side role check and redirects to `/login` if the user is not `admin` or `recruiting_manager`.

### Logout
Always use `POST /auth/signout` — it calls `supabase.auth.signOut()` and redirects to `/login`. Use a `<form action="/auth/signout" method="POST">` in any component.

### File Uploads
Use `src/lib/uploadQueue.ts` — it wraps Supabase Storage with 3 retries and 10-second backoff. Do not call `supabase.storage` directly for user-facing uploads.

### PDF Generation
`/api/contracts/generate-pdf` uses Puppeteer + `@sparticuz/chromium`. These are declared as `serverExternalPackages` in `next.config.ts` — do not import them in client code or shared utilities.

### AI Features
- **Contract generation:** `src/lib/contracts.ts` calls the Claude API to generate HTML contracts.
- **Candidate insights:** `src/lib/generateInsights.ts` calls Claude for profile summaries.
- **Role classification:** `/api/candidate/classify-role` — AI categorizes the candidate's role.
- **Job matching:** `/api/match` — AI ranks candidates against a job posting.

---

## Admin Panel

### Access
`/(admin)/layout.tsx` — role must be `admin` or `recruiting_manager`. Redirects to `/login` otherwise.

### Layout Components
- `AdminSidebar` — Left nav (200px, dark `#1C1B1A`). Includes logout button at bottom.
- `AdminTopbar` — Top bar (48px, white). Shows page name, clock, Export + Approve buttons on dashboard.

### Command Center API
`/api/admin/command-center` returns unified badges + metrics for the sidebar badge counts and dashboard widgets. This is fetched on mount by `AdminSidebar`.

---

## Key Files to Know

| File | Why it matters |
|---|---|
| `src/middleware.ts` | Runs on every non-API page request — session refresh + auth redirects |
| `src/lib/auth.ts` | All auth helpers — start here for any auth question |
| `src/lib/types/database.ts` | Source of truth for all DB types and enums |
| `src/lib/approvalGates.ts` | The 11 conditions a candidate must meet to go live |
| `src/app/(admin)/layout.tsx` | Admin role gate + layout shell |
| `src/components/admin/AdminSidebar.tsx` | Admin navigation + logout |
| `src/app/api/admin/command-center/route.ts` | Unified metrics API for the admin dashboard |
| `vercel.json` | All cron job definitions |
