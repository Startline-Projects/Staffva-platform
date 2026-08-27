import LegalShell from "@/components/legal/LegalShell";

export const metadata = {
  title: "Cookie Policy — StaffVA",
  description: "The cookies StaffVA uses, and why.",
};

// This page is short because the truth is short: the only cookies in the
// product are Supabase auth session cookies. There is no analytics, ad or
// tracking script anywhere in either app. If one is ever added, this page is
// wrong until it says so.
export default function CookiePolicy() {
  return (
    <LegalShell title="Cookie Policy" updated="August 27, 2026 (v1.0)">
      <p>
        StaffVA uses only <strong>essential cookies</strong> — the ones
        required to keep you signed in. We use no advertising cookies, no
        analytics cookies, and no third-party trackers of any kind.
      </p>

      <h2>The cookies we set</h2>
      <table>
        <thead>
          <tr>
            <th>Cookie</th>
            <th>Purpose</th>
            <th>Lifetime</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>sb-*</code> (authentication)
            </td>
            <td>
              Keeps you signed in to your StaffVA account and refreshes your
              session securely. Set by our authentication provider, Supabase.
            </td>
            <td>For your session, refreshed while you remain signed in.</td>
          </tr>
        </tbody>
      </table>

      <h2>Managing cookies</h2>
      <p>
        Because these cookies are essential, the platform cannot function
        without them — blocking them in your browser will sign you out. There
        is nothing optional to opt out of: we have no tracking to disable.
      </p>

      <h2>Contact</h2>
      <p>
        Questions? <a href="mailto:support@staffva.com">support@staffva.com</a>
      </p>
    </LegalShell>
  );
}
