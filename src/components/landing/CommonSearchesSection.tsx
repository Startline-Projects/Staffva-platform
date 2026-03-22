import Link from "next/link";

const COMMON_ROLES = [
  "Paralegal",
  "Legal Assistant",
  "Bookkeeper",
  "Accounts Payable",
  "Admin Assistant",
  "Virtual Assistant",
  "Scheduling Coordinator",
  "Customer Support",
  "Medical Billing",
  "Executive Assistant",
];

export default function CommonSearchesSection() {
  return (
    <section className="bg-card py-10 border-b border-gray-100">
      <div className="mx-auto max-w-7xl px-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-text/40">
          Common searches
        </p>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-2.5">
          {COMMON_ROLES.map((role) => (
            <Link
              key={role}
              href={`/browse?search=${encodeURIComponent(role)}`}
              className="text-sm font-medium text-primary hover:text-primary-dark hover:underline underline-offset-2 transition-colors"
            >
              {role}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
