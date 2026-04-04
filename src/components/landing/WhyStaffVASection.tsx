export default function WhyStaffVASection() {
  const cards = [
    {
      title: "Hear them first.",
      description: "Every profile includes two voice recordings — an oral reading and a professional introduction. No other platform has this. You know how they communicate before you spend a dollar.",
      icon: (
        <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
        </svg>
      ),
    },
    {
      title: "Reviewed by humans. Locked forever.",
      description: "Every English and speaking badge is assigned by a real reviewer and permanently locked. Candidates cannot edit it. We reject more than 70% of applicants.",
      icon: (
        <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      ),
    },
    {
      title: "Protected by escrow.",
      description: "Every payment goes into escrow before work begins. You release funds only when satisfied. A dedicated dispute team handles the rare exception.",
      icon: (
        <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      ),
    },
  ];

  return (
    <section className="bg-charcoal py-20">
      <div className="mx-auto max-w-7xl px-6">
        <h2 className="text-center text-3xl font-bold text-white">
          Built different.
        </h2>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-6">
          {cards.map((card) => (
            <div
              key={card.title}
              className="rounded-2xl p-7 border border-white/[0.08]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary/10">
                {card.icon}
              </div>
              <h3 className="mt-5 text-[15px] font-medium text-white">{card.title}</h3>
              <p className="mt-3 text-[13px] leading-[1.75] text-white/45">{card.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
