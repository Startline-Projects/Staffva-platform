const STATS = [
  { number: "<30%", label: "Acceptance rate — we reject most applicants" },
  { number: "100%", label: "Human-reviewed English and speaking assessment" },
  { number: "$0", label: "Fees charged to candidates — ever" },
  { number: "10", label: "Countries represented in the talent pool" },
];

export default function StatsStripSection() {
  return (
    <section className="bg-[#1C1B1A]">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {STATS.map((stat, i) => (
            <div
              key={stat.number}
              className={`flex flex-col items-center justify-center py-7 px-6 lg:px-12 text-center ${
                i < STATS.length - 1 ? "border-r border-white/[0.07]" : ""
              } ${i === 1 ? "border-r-0 lg:border-r" : ""}`}
            >
              <p
                className="text-[32px] font-light text-[#FE6E3E]"
                style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
              >
                {stat.number}
              </p>
              <p className="mt-1.5 text-[11px] text-white/[0.35] tracking-[0.04em] leading-snug max-w-[200px]">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
