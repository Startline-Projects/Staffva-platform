import Link from "next/link";

export default function SubscriptionCancelPage() {
  return (
    <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-text">
          Subscription Not Completed
        </h1>
        <p className="mt-3 text-text/60">
          You can subscribe anytime to unlock direct messaging with candidates.
          Browse profiles freely — no subscription required to look around.
        </p>
        <Link
          href="/browse"
          className="mt-6 inline-block rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
        >
          Continue Browsing
        </Link>
      </div>
    </main>
  );
}
