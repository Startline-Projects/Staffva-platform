/**
 * Shared frame for the legal pages (/privacy, /terms, /cookies).
 *
 * These pages exist because nothing did: the footer's legal links were
 * literally href="#" while the product collected assessment data, voice
 * recordings and identity-verification outcomes. The content of each page
 * describes what the code actually does — when the product changes, the page
 * and its version line must change in the same commit.
 */
export default function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold text-text">{title}</h1>
      <p className="mt-2 text-sm text-text/60">
        Last updated {updated} · Stafva LLC, Dearborn, Michigan, United States
      </p>
      <div className="legal-body mt-10 space-y-4 text-[15px] leading-relaxed text-text/90 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-text [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-text [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1.5 [&_a]:text-primary [&_a]:underline [&_table]:w-full [&_table]:text-sm [&_th]:text-left [&_th]:font-semibold [&_th]:py-2 [&_th]:border-b [&_th]:border-text/20 [&_td]:py-2 [&_td]:border-b [&_td]:border-text/10 [&_td]:align-top">
        {children}
      </div>
    </main>
  );
}
