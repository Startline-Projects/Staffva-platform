import Link from "next/link";

interface Props {
  totalApproved: number;
  uniqueCountries: number;
}

export default function ForCandidatesSection({ totalApproved, uniqueCountries }: Props) {
  const stats = [
    { value: totalApproved > 0 ? totalApproved.toString() : "50+", label: "Vetted Professionals" },
    { value: "<30%", label: "Acceptance Rate" },
    { value: uniqueCountries > 0 ? uniqueCountries.toString() : "10+", label: "Countries Represented" },
  ];

  return (
    <section className="bg-charcoal py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
              <span className="text-primary">Keep everything you earn.</span>
            </h2>

            <ul className="mt-8 space-y-4">
              {[
                "No fees to apply. No fees ever.",
                "Get paid through escrow before you start.",
                "Build a verified earnings record that follows your career.",
              ].map((line) => (
                <li key={line} className="flex items-start gap-3">
                  <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-gray-300 text-base">{line}</span>
                </li>
              ))}
            </ul>

            <div className="mt-10">
              <Link href="/apply" className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors">
                Apply Now
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white/5 border border-white/10 p-6 text-center">
                <p className="text-3xl font-bold text-primary">{stat.value}</p>
                <p className="mt-2 text-sm text-gray-400">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
