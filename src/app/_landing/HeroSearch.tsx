'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const CHIPS = [
  { label: 'Virtual Assistant', role: 'Virtual Assistant' },
  { label: 'Bookkeeper',        role: 'Bookkeeper' },
  { label: 'Social Media',      role: 'Social Media Manager' },
  { label: 'Paralegal',         role: 'Paralegal' },
  { label: 'Video Editor',      role: 'Video Editor' },
];

export default function HeroSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  function navigate() {
    const q = query.trim();
    router.push(q ? `/browse?search=${encodeURIComponent(q)}` : '/browse');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') navigate();
  }

  function handleChip(label: string, role: string) {
    router.push(
      `/browse?search=${encodeURIComponent(label)}&role=${encodeURIComponent(role)}`
    );
  }

  return (
    <div className="search-container">
      <div className="search-bar">
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
          placeholder='Search by role — "paralegal", "bookkeeper", "social media manager"'
        />
        <button className="search-btn" type="button" onClick={navigate}>
          Search
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

      <div className="quick-tags">
        <span className="label">Popular:</span>
        {CHIPS.map((chip) => (
          <button
            key={chip.label}
            className="tag"
            type="button"
            onClick={() => handleChip(chip.label, chip.role)}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
