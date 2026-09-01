import LegalShell from "@/components/legal/LegalShell";

export const metadata = {
  title: "Privacy Policy — StaffVA",
  description: "How StaffVA collects, uses, shares and retains your information.",
};

// Every statement on this page was checked against the codebase on the date
// below. Do not add claims here that the product does not do, and do not add
// processing to the product without updating this page in the same change.
export default function PrivacyPolicy() {
  return (
    <LegalShell title="Privacy Policy" updated="September 1, 2026 (v1.2)">
      <p>
        StaffVA is a marketplace operated by Stafva LLC (&quot;StaffVA&quot;,
        &quot;we&quot;) that connects businesses with remote professionals. This
        policy explains what information we collect on staffva.com and
        interview.staffva.com, why we collect it, who we share it with, and the
        choices you have. It applies to candidates, clients and visitors.
      </p>

      <h2>What we collect</h2>
      <h3>From candidates</h3>
      <ul>
        <li>
          <strong>Account and application details</strong> — name, email
          address, country, time zone, role, years of experience, expected
          rate, and the application answers you provide.
        </li>
        <li>
          <strong>Profile content</strong> — photo, résumé, bio, tagline,
          skills, tools, work history, portfolio items, availability, LinkedIn
          URL, and payout method. Parts of your profile, including your photo,
          voice recordings and assessment badges, are visible to clients on the
          marketplace — that is what the profile is for.
        </li>
        <li>
          <strong>Assessment data</strong> — your English test answers, the
          time you spend on each question, and screen-focus events during the
          test (for example, leaving the test tab). Assessment integrity
          signals are reviewed before any adverse decision is made.
        </li>
        <li>
          <strong>Voice recordings</strong> — the two recordings you submit
          (an oral reading and a self-introduction). These are stored and are
          playable by clients viewing your profile.
        </li>
        <li>
          <strong>AI interview</strong> — during the interview your spoken
          answers are processed to produce a transcript, and the transcript,
          scores and feedback are stored. The raw answer audio is processed for
          transcription and is not retained afterwards.
        </li>
        <li>
          <strong>Proctored assessment recordings</strong> — assessment
          sessions (currently the English test) are camera-proctored. With
          your explicit, versioned consent — collected before the session,
          and required to sit the assessment — your camera records video for
          the whole session, along with periodic still frames; no audio is
          captured. An automated review examines the frames and the session&apos;s
          integrity events afterward. If nothing is flagged, the recording
          and frames are <strong>deleted right after that review</strong> and
          only the review outcome is kept. If the session is flagged, the
          recording is preserved for review by a member of our team — only a
          person can decide an integrity issue — and is deleted 7 days after
          that decision. A visible indicator shows whenever the camera is
          recording.
        </li>
        <li>
          <strong>Identity verification</strong> — verification is performed by
          Stripe Identity. Your identity document and selfie are collected and
          held by Stripe under its own privacy policy; we store the outcome
          (passed, failed, or under review), not the document images.
        </li>
        <li>
          <strong>Payout details</strong> — the payout method you choose (for
          example Wise, Payoneer or bank transfer) and the account details
          needed to pay you.
        </li>
      </ul>
      <h3>From clients</h3>
      <ul>
        <li>
          Account details, company information, job posts, offers, contracts,
          and payment information. Card and payment details are collected and
          processed by Stripe; we do not store full card numbers.
        </li>
      </ul>
      <h3>From interviews between clients and candidates</h3>
      <ul>
        <li>
          <strong>Interview recordings</strong> — when a client books an
          interview with a candidate, the call happens in a video room on
          StaffVA and is recorded (video and audio). Recording is a standing
          feature of on-platform interviews: both parties agree to it before
          they can join, and neither party can turn it off.
        </li>
        <li>
          <strong>Transcripts</strong> — after the call, the recording is
          transcribed automatically into a speaker-labeled transcript.
        </li>
        <li>
          <strong>Automated safety review</strong> — transcripts are reviewed
          automatically for attempts to take the working relationship off the
          platform, such as exchanging direct contact details or arranging
          outside payment. Conversations the automated review flags are read
          by our team. No adverse decision is made automatically.
        </li>
      </ul>
      <h3>From everyone</h3>
      <ul>
        <li>
          Messages sent through the platform (including candidate–client and
          candidate–recruiter chat), support emails, dispute submissions, and
          the technical logs our hosting providers generate (such as IP
          address and request timestamps). We use only essential cookies — see
          the <a href="/cookies">Cookie Policy</a>.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To run the marketplace: profiles, search, matching, offers, contracts, escrow and payouts.</li>
        <li>
          To assess and vet candidates. Parts of this are automated: the
          English test is scored automatically, applications are screened with
          AI assistance, and the AI interview is scored by an AI model. A
          passing result and a complete profile lead to approval without a
          separate human interview. Failed assessments can be retaken under the
          posted retake rules.
        </li>
        <li>
          To protect the integrity of assessments. Automated signals (such as
          leaving the test screen) are recorded and may flag a session for
          review by our team; adverse decisions about integrity are made by
          people, not automatically.
        </li>
        <li>
          To prepare clients for interviews: we generate interview guidance
          for the client from the candidate&apos;s marketplace profile and
          StaffVA screening results.
        </li>
        <li>To communicate with you about your application, account and transactions.</li>
        <li>To handle disputes, prevent fraud and duplicate accounts, and comply with law.</li>
      </ul>

      <h2>Who we share it with</h2>
      <p>
        We do not sell personal information, and we use no advertising or
        analytics trackers. We share information with service providers who
        process it on our behalf:
      </p>
      <ul>
        <li><strong>Supabase</strong> — database, authentication and file storage.</li>
        <li><strong>Vercel</strong> — application hosting.</li>
        <li><strong>Stripe</strong> — client payments, escrow and identity verification.</li>
        <li><strong>Anthropic</strong> — AI processing of application screening, interview scoring, the automated review of interview transcripts and of proctored-session frames, and interview preparation for clients.</li>
        <li><strong>Daily</strong> — video infrastructure for client–candidate interviews: the call, the recording, and the transcription pipeline.</li>
        <li><strong>Deepgram</strong> — speech-to-text transcription during the AI interview and (via Daily) of interview recordings.</li>
        <li><strong>ElevenLabs</strong> — text-to-speech for the AI interviewer&apos;s voice.</li>
        <li><strong>Resend</strong> — transactional email delivery.</li>
      </ul>
      <p>
        Clients using the marketplace see the candidate profile content
        described above. We may also disclose information where the law
        requires it or to protect the platform and its users.
      </p>

      <h2>Where it is processed</h2>
      <p>
        We are a United States company and our providers process data in the
        United States and other countries. Wherever your data is processed,
        this policy applies to it.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Account and profile data: for as long as your account exists.</li>
        <li>Assessment results, transcripts and integrity events: for as long as your account exists, because they are the basis of your standing on the marketplace.</li>
        <li>
          Client–candidate interview recordings: deleted 30 days after the
          interview. Interview transcripts: for as long as your account
          exists, as part of the safety and dispute record.
        </li>
        <li>
          Proctored assessment recordings: deleted right after the automated
          review when nothing is flagged; when flagged, kept until a person
          decides and deleted 7 days after the decision.
        </li>
        <li>Transaction, contract and dispute records: retained as needed for legal, tax and accounting obligations, even after account deletion.</li>
        <li>
          To request deletion of your account and data, email{" "}
          <a href="mailto:support@staffva.com">support@staffva.com</a>. We will
          delete what we are not legally required to keep.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Depending on where you live — including under the Philippine Data
        Privacy Act and, where it applies, the GDPR — you may have rights to
        access, correct, delete, or object to processing of your personal
        information, and to receive a copy of it. To exercise any of these,
        email <a href="mailto:support@staffva.com">support@staffva.com</a>. We
        will respond to verified requests within 30 days. If you believe we
        have not handled your data properly, you may also complain to your
        local data-protection authority.
      </p>

      <h2>Age</h2>
      <p>
        StaffVA is for people 18 and older. We do not knowingly collect
        information from anyone under 18.
      </p>

      <h2>Changes</h2>
      <p>
        When this policy changes, we will update the date and version above and
        post the new version here. For material changes — such as new
        categories of data collection — we will notify you by email and, where
        the law requires it, ask for your consent before the change applies to
        you.
      </p>

      <h2>Contact</h2>
      <p>
        Stafva LLC, Dearborn, Michigan, United States ·{" "}
        <a href="mailto:support@staffva.com">support@staffva.com</a>
      </p>
    </LegalShell>
  );
}
