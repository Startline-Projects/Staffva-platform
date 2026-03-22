"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function FinalCTASection() {
  const [query, setQuery] = useState("");
  const router = useRouter();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/browse?search=${encodeURIComponent(query.trim())}`);
    } else {
      router.push("/browse");
    }
  }

  return (
    <section className="bg-primary py-20">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold text-white">
          Start browsing in 10 seconds.
        </h2>

        <form onSubmit={handleSearch} className="mt-8 flex gap-2 max-w-lg mx-auto">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Try "paralegal" or "bookkeeper"...'
            className="flex-1 rounded-lg bg-white px-4 py-3.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/50"
          />
          <button
            type="submit"
            className="rounded-lg bg-[#1C1B1A] px-6 py-3.5 text-sm font-semibold text-white hover:bg-[#2a2928] transition-colors whitespace-nowrap"
          >
            Search
          </button>
        </form>

        <p className="mt-5 text-sm text-white/80">
          No signup required. No subscription. No catch.
        </p>

        <Link
          href="/apply"
          className="mt-3 inline-block text-sm text-white underline underline-offset-2 hover:text-white/80 transition-colors"
        >
          Are you a professional? Apply here
        </Link>
      </div>
    </section>
  );
}
