'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CtaSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  function navigate() {
    const q = query.trim();
    router.push(q ? `/browse?search=${encodeURIComponent(q)}` : '/browse');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') navigate();
  }

  return (
    <div className="final-cta-search">
      <svg
        className="search-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder='Search a role — "paralegal", "bookkeeper", "executive assistant"'
      />
      <button
        className="final-cta-search-btn"
        type="button"
        onClick={navigate}
      >
        Find your hire
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>
    </div>
  );
}
