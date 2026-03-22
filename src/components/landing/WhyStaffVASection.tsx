export default function WhyStaffVASection() {
  const cards = [
    {
      title: "Candidates keep 100% of what they earn",
      description:
        "Other platforms take 5-20% from your hire\u2019s paycheck. StaffVA charges candidates nothing. Ever. They stay because they want to.",
      icon: (
        <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: "Human-reviewed. Not algorithm-matched.",
      description:
        "Every candidate passed a written English test and a live speaking assessment reviewed by a real person. Their badge is locked. They cannot edit it.",
      icon: (
        <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    },
    {
      title: "Your money is protected before work starts",
      description:
        "Payments go into escrow before each period begins. You only release when satisfied. A dedicated team handles the rare dispute.",
      icon: (
        <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
    },
  ];

  return (
    <section className="bg-card py-20">
      <div className="mx-auto max-w-7xl px-6">
        <h2 className="text-center text-3xl font-bold text-text">
          Built differently. On purpose.
        </h2>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-8">
          {cards.map((card) => (
            <div
              key={card.title}
              className="rounded-xl border border-gray-200 p-7 hover:shadow-md transition-shadow"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                {card.icon}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-text">
                {card.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-text/60">
                {card.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
