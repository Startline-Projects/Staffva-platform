import Link from "next/link";

export default function SubscriptionSuccessPage() {
  return (
    <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg
            className="h-8 w-8 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-text">
          Subscription Activated
        </h1>
        <p className="mt-3 text-text/60">
          Your $99/month subscription is now active. You can message any
          candidate directly from their profile.
        </p>
        <Link
          href="/browse"
          className="mt-6 inline-block rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
        >
          Browse Talent
        </Link>
      </div>
    </main>
  );
}
