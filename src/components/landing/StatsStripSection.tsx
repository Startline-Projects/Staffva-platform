const STATS = [
  { number: "<30%", label: "Acceptance rate" },
  { number: "100%", label: "Human-reviewed assessments" },
  { number: "$0", label: "Candidate fees. Ever." },
  { number: "10", label: "Countries represented" },
];

export default function StatsStripSection() {
  return (
    <section className="bg-charcoal">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {STATS.map((stat, i) => (
            <div
              key={stat.number}
              className={`flex flex-col items-center justify-center py-7 px-6 lg:px-12 text-center ${
                i < STATS.length - 1 ? "border-r border-white/[0.07]" : ""
              } ${i === 1 ? "max-lg:border-r-0" : ""}`}
            >
              <p className="text-[2rem] font-light text-primary font-serif">{stat.number}</p>
              <p className="mt-1.5 text-[11px] text-white/35 tracking-wide leading-snug max-w-[200px]">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
