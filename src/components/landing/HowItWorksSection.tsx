export default function HowItWorksSection() {
  const steps = [
    {
      number: "1",
      title: "Browse free",
      description:
        "No login, no subscription required. See every vetted candidate instantly.",
    },
    {
      number: "2",
      title: "Create a free account",
      description:
        "View full profiles and message candidates directly. No credit card needed.",
    },
    {
      number: "3",
      title: "Hire through escrow",
      description:
        "Work starts. Payments are held in escrow. You only release when satisfied.",
    },
  ];

  return (
    <section className="bg-card py-20">
      <div className="mx-auto max-w-7xl px-6">
        <h2 className="text-center text-3xl font-bold text-text">
          Three steps. No subscription.
        </h2>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-10">
          {steps.map((step) => (
            <div key={step.number} className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <span className="text-2xl font-bold text-primary">
                  {step.number}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-text">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-text/60">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
