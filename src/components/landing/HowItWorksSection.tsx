export default function HowItWorksSection() {
  const steps = [
    {
      number: "1",
      title: "Browse free",
      description: "See every vetted professional instantly. No login required.",
    },
    {
      number: "2",
      title: "Create a free account",
      description: "View full profiles, hear voice recordings, and message directly. No credit card.",
    },
    {
      number: "3",
      title: "Hire through escrow",
      description: "Payments are held in escrow. You release when satisfied. Work begins.",
    },
  ];

  return (
    <section className="bg-card py-20">
      <div className="mx-auto max-w-7xl px-6">
        <h2 className="text-center text-3xl font-bold text-text">
          Three steps. That&apos;s it.
        </h2>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-10">
          {steps.map((step) => (
            <div key={step.number} className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <span className="text-2xl font-bold text-primary">{step.number}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-text">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
