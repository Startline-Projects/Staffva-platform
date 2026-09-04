"use client";

import { useEffect, useState } from "react";

/**
 * The reference contact attached to one employer.
 *
 * The copy here is the whole point of the component, so it is worth saying why
 * it differs from the prototype. Atlas promises:
 *
 *   "we email or WhatsApp each contact after Miguel approves your profile —
 *    never before. Only US, UK, Canadian, and Australian references can leave
 *    public reviews on your profile."
 *
 * Three of those claims are not true of this product. There is no WhatsApp
 * messaging — the only Twilio product wired up is Verify, which delivers OTP
 * codes and cannot send free text. There is no reference-authored review: the
 * reviews table requires a client id and an engagement, so a former employer
 * cannot occupy a row in it from any country. And "after approval" would be a
 * promise about the future with nothing holding it.
 *
 * What IS true is narrower and stronger: nothing sends today, at all, and the
 * database refuses to record that a reference was contacted unless an admin
 * has deliberately released them (migration 00179). So that is what we say.
 */

export interface ReferenceValue {
  fullName: string;
  jobTitle: string;
  email: string;
  countryCode: string;
  consent: boolean;
  contactState?: string;
}

const EMPTY: ReferenceValue = {
  fullName: "",
  jobTitle: "",
  email: "",
  countryCode: "",
  consent: false,
};

// Where references most often are, then everywhere else. Country is stored
// because which rules apply to contacting someone depends on where they are —
// and nothing else is claimed about it.
const COUNTRIES: { code: string; name: string }[] = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "PH", name: "Philippines" },
  { code: "SG", name: "Singapore" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "NZ", name: "New Zealand" },
  { code: "IE", name: "Ireland" },
  { code: "IN", name: "India" },
  { code: "ZA", name: "South Africa" },
  { code: "OTHER", name: "Somewhere else" },
];

export default function ReferenceFields({
  employerKey,
  employerName,
  value,
  onChange,
}: {
  employerKey: string;
  employerName: string;
  value: ReferenceValue | undefined;
  onChange: (v: ReferenceValue) => void;
}) {
  const v = value ?? EMPTY;
  const [touched, setTouched] = useState(false);

  const set = (patch: Partial<ReferenceValue>) => {
    setTouched(true);
    onChange({ ...v, ...patch });
  };

  const started = !!(v.fullName || v.email || v.jobTitle);
  const emailLooksWrong =
    touched && !!v.email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v.email.trim());

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-sm font-semibold text-text">
          Reference for {employerName || "this role"}{" "}
          <span className="font-normal text-text/50">— optional</span>
        </p>
        {/* Rendered from the row's own contact_state, which the database will
            not let leave 'never_contacted' without a deliberate admin release.
            It is not a hopeful label. */}
        <span className="rounded-full bg-gray-200 px-2.5 py-1 text-[11px] font-medium text-text/70">
          {v.contactState === "never_contacted" || !v.contactState
            ? "Not contacted"
            : v.contactState}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-text/70" htmlFor={`ref-name-${employerKey}`}>
            Their name
          </label>
          <input
            id={`ref-name-${employerKey}`}
            type="text"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={v.fullName}
            onChange={(e) => set({ fullName: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text/70" htmlFor={`ref-title-${employerKey}`}>
            Their job title
          </label>
          <input
            id={`ref-title-${employerKey}`}
            type="text"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={v.jobTitle}
            onChange={(e) => set({ jobTitle: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text/70" htmlFor={`ref-email-${employerKey}`}>
            Their work email
          </label>
          <input
            id={`ref-email-${employerKey}`}
            type="email"
            className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
              emailLooksWrong ? "border-red-400" : "border-gray-300"
            }`}
            value={v.email}
            onChange={(e) => set({ email: e.target.value })}
            autoComplete="off"
          />
          {emailLooksWrong && (
            <p className="mt-1 text-xs text-red-600">That doesn&apos;t look like an email address.</p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-text/70" htmlFor={`ref-country-${employerKey}`}>
            Where are they based?
          </label>
          <select
            id={`ref-country-${employerKey}`}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={v.countryCode}
            onChange={(e) => set({ countryCode: e.target.value })}
          >
            <option value="">Select a country</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {started && (
        <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-text/70">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={v.consent}
            onChange={(e) => set({ consent: e.target.checked })}
          />
          <span>
            I confirm this person has agreed to be my reference, and knows StaffVA will hold
            their name, job title, email and country.
          </span>
        </label>
      )}

      <p className="mt-3 border-t border-gray-200 pt-3 text-xs leading-relaxed text-text/60">
        <strong className="font-semibold text-text/80">
          We store this contact. We are not contacting anyone yet.
        </strong>{" "}
        Their details stay with us until a StaffVA specialist has approved your profile — and
        right now we are not sending reference requests at all. Every contact shows its status
        above, and it will read <em>Not contacted</em> until that changes. We will tell you
        before it does.
      </p>
    </div>
  );
}

/** Load the caller's saved references, keyed by employer. */
export function useSavedReferences() {
  const [byEmployer, setByEmployer] = useState<Record<string, ReferenceValue>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/candidate/references")
      .then((r) => (r.ok ? r.json() : { references: [] }))
      .then((d) => {
        if (!alive) return;
        const map: Record<string, ReferenceValue> = {};
        for (const r of d.references ?? []) {
          map[r.employer_key] = {
            fullName: r.full_name ?? "",
            jobTitle: r.job_title ?? "",
            email: r.email ?? "",
            countryCode: r.country_code ?? "",
            consent: !!r.consent_asserted,
            contactState: r.contact_state,
          };
        }
        setByEmployer(map);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  return { byEmployer, setByEmployer, loaded };
}

/** Persist one employer's reference. Returns an error message, or null. */
export async function saveReference(
  employerKey: string,
  v: ReferenceValue
): Promise<string | null> {
  try {
    const res = await fetch("/api/candidate/references", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employerKey,
        fullName: v.fullName,
        jobTitle: v.jobTitle,
        email: v.email,
        countryCode: v.countryCode === "OTHER" ? null : v.countryCode,
        consent: v.consent,
      }),
    });
    if (res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return body.error || "We couldn't save that reference.";
  } catch {
    return "We couldn't reach the server.";
  }
}
