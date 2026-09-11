import LegalShell from "@/components/legal/LegalShell";

export const metadata = {
  title: "Terms of Service — StaffVA",
  description: "The terms that govern use of the StaffVA marketplace.",
};

// The commitments in here mirror what the product actually enforces — the
// 48-hour dispute window is checked in /api/disputes/file, escrow release in
// the engagement routes, retake rules in the interview app, and the
// non-circumvention rules in section 5 by the message blocker, contact
// masking (lib/contactMask), interview recording consent, and the transcript
// watchdog. Keep them in sync.
export default function TermsOfService() {
  return (
    <LegalShell title="Terms of Service" updated="September 1, 2026 (v1.2)">
      <p>
        These terms are an agreement between you and Stafva LLC
        (&quot;StaffVA&quot;, &quot;we&quot;) and govern your use of
        staffva.com, interview.staffva.com and the StaffVA marketplace. By
        creating an account or using the platform you agree to them.
      </p>

      <h2>1. What StaffVA is</h2>
      <p>
        StaffVA is a marketplace that connects businesses
        (&quot;clients&quot;) with independent remote professionals
        (&quot;candidates&quot; or &quot;professionals&quot;). StaffVA is not
        an employer, staffing agency or party to the working relationship.
        Professionals on StaffVA are independent contractors of the clients
        who engage them; nothing on the platform creates an employment
        relationship with StaffVA.
      </p>

      <h2>2. Accounts and eligibility</h2>
      <ul>
        <li>You must be at least 18 and able to enter a binding contract.</li>
        <li>You must provide accurate information and keep it current. One account per person; accounts are not transferable.</li>
        <li>You are responsible for activity under your account and for keeping your credentials secure.</li>
      </ul>

      <h2>3. Vetting and assessments</h2>
      <ul>
        <li>
          Being listed on the marketplace does not by itself mean a candidate
          has been assessed. Candidates who complete StaffVA screening — a
          structured, camera-proctored skills interview — carry a vetted
          marker on their profile; profiles without it show that screening
          has not been completed. Other assessments may be offered or
          required, including an English test, voice recordings and an
          AI-conducted interview. Assessment content and passing requirements
          may change as the platform evolves, and additional or repeated
          assessments may be required — including re-taking assessments under
          updated integrity monitoring.
        </li>
        <li>
          Identity verification is not required before a profile goes live.
          Candidates get a window after their assessments to verify, and a
          profile whose window passes unverified is hidden from the
          marketplace. A listed profile does not by itself mean the
          person&apos;s identity has been verified.
        </li>
        <li>
          Assessment sessions are monitored for integrity, and proctored
          sessions are camera-recorded with your consent — a working camera
          is required to sit them. Automated review may flag a session;
          decisions that reject a candidate for an integrity violation are
          made by a person after reviewing the evidence. Recording, review
          and retention are described in the{" "}
          <a href="/privacy">Privacy Policy</a>.
        </li>
        <li>
          Dishonesty in an assessment — including having another person take
          any part of it, or misrepresenting your identity — may result in
          rejection, removal from the marketplace, and refusal of future
          applications.
        </li>
        <li>Failed assessments may be retaken under the retake rules shown in your dashboard.</li>
        <li>Acceptance to the marketplace is at StaffVA&apos;s discretion.</li>
        <li>
          <strong>The assessments are optional. Your first sitting of each is
          free.</strong> Neither the English assessment nor the skills
          interview is required to create a profile or to be listed. Your first
          sitting of each is free; after that a <strong>retake costs $5</strong>{" "}
          and buys <strong>one sitting</strong>. The price is shown before you
          pay, and you are never charged for a first sitting.
        </li>
        <li>
          <strong>What a payment does and does not buy.</strong> It buys the
          sitting, not a result: a score below the pass mark is not refunded,
          and no assessment guarantees work, a badge, or a particular position
          in search. If a technical failure on StaffVA&apos;s side prevents your
          sitting from being delivered or scored, <strong>we refund you
          automatically</strong> — you do not have to ask. If you believe a
          sitting was lost and no refund reached you, contact{" "}
          <a href="mailto:support@staffva.com">support@staffva.com</a>.
        </li>
        <li>
          A purchased sitting stays yours until you use it. Starting an
          assessment uses it; reconnecting to an assessment already in
          progress does not.
        </li>
      </ul>

      <h2>4. Payments, escrow and disputes</h2>
      <ul>
        <li>
          Client payments are processed by Stripe and held in escrow for the
          engagement. Funds release to the professional when the client
          releases them or when a work period completes.
        </li>
        <li>
          Either party may file a dispute within <strong>48 hours</strong> of a
          work period ending or a milestone being marked complete. StaffVA
          reviews disputes and decides them, which may include releasing,
          splitting or refunding escrowed funds. Dispute decisions are final.
        </li>
        <li>
          Any StaffVA fees are shown to you before you commit to a
          transaction.
        </li>
        <li>Professionals are paid to the payout method on their profile. Taxes on earnings are the professional&apos;s own responsibility.</li>
      </ul>

      <h2>5. Interviews, hiring and non-circumvention</h2>
      <ul>
        <li>
          Interviews between clients and candidates take place on StaffVA, in
          the platform&apos;s video room. Interviews are recorded and
          transcribed, and both parties must agree to that before joining. The
          recording, its automated review and its retention are described in
          the <a href="/privacy">Privacy Policy</a>.
        </li>
        <li>
          If you met through StaffVA, you hire through StaffVA. Offers,
          contracts and payment for a professional the platform introduced to
          you must go through the platform.
        </li>
        <li>
          For 24 months after an introduction through StaffVA — a first
          message, interview or engagement — clients and professionals may not
          solicit, hire, contract with or pay one another outside the
          platform. StaffVA does not offer a buy-out or conversion fee; no
          payment makes an off-platform arrangement permitted.
        </li>
        <li>
          Before a contract is in place, sharing direct contact details —
          email, phone number, social or messaging handles — through the
          platform is not permitted, in either direction.
        </li>
        <li>
          Circumvention, attempting it, or helping another user attempt it may
          result in suspension or removal under section 8, and the
          circumventing parties remain liable to StaffVA for the platform fees
          that would have applied to the engagement.
        </li>
      </ul>

      <h2>6. Your content</h2>
      <p>
        You own the content you submit — your profile, photo, recordings,
        résumé and portfolio. You grant StaffVA a license to host, process and
        display that content for the purpose of operating the marketplace,
        including showing your profile to prospective clients. Handling of
        personal information is described in the{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>7. Acceptable use</h2>
      <ul>
        <li>No unlawful activity, fraud, or misrepresentation of identity, skills or experience.</li>
        <li>No interfering with the platform, probing its security, scraping it, or accessing data that is not yours.</li>
        <li>No harassment or abuse of other users or of StaffVA staff.</li>
        <li>No using the platform to collect personal data about others.</li>
      </ul>

      <h2>8. Suspension and termination</h2>
      <p>
        You may close your account at any time. We may suspend or terminate an
        account that violates these terms, compromises the integrity of the
        marketplace, or creates legal risk. Where an engagement is in flight,
        escrowed funds are handled under section 4.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        The platform is provided &quot;as is&quot;. We do not guarantee that a
        candidate will find work, that a client will find a professional, or
        the outcome of any engagement. Not every professional on the platform
        has completed StaffVA screening. Where it has happened, vetting
        reduces risk; it is not a warranty of any professional&apos;s work.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent the law allows, StaffVA&apos;s total liability
        arising out of the platform is limited to the fees you paid to StaffVA
        in the twelve months before the claim, and we are not liable for
        indirect, incidental or consequential damages. Nothing in these terms
        limits liability that cannot lawfully be limited.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These terms are governed by the laws of the State of Michigan, United
        States, without regard to conflict-of-law rules.
      </p>

      <h2>12. Changes</h2>
      <p>
        We may update these terms. We will post updates here and, for material
        changes, notify you by email. Continuing to use the platform after a
        change takes effect means you accept it.
      </p>

      <h2>13. Contact</h2>
      <p>
        Stafva LLC, Dearborn, Michigan, United States ·{" "}
        <a href="mailto:hello@staffva.com">hello@staffva.com</a>
      </p>
    </LegalShell>
  );
}
