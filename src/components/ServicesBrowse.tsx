"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface ServiceCandidate {
  id: string;
  display_name: string;
  country: string;
  role_category: string;
  profile_photo_url: string | null;
  english_written_tier: string | null;
  reputation_tier: string | null;
  hourly_rate: number;
}

interface ServicePackage {
  id: string;
  title: string;
  description: string;
  whats_included: string[];
  delivery_days: number;
  price_usd: number;
  category: string;
  outcome_category: string | null;
  candidates: ServiceCandidate | null;
}

const OUTCOME_SECTIONS = [
  { key: "reviewed", label: "Get something reviewed", icon: "📋" },
  { key: "written", label: "Get something written", icon: "✍️" },
  { key: "designed", label: "Get something designed", icon: "🎨" },
  { key: "organized", label: "Get something organized", icon: "📁" },
  { key: "built", label: "Get something built", icon: "🔧" },
  { key: "managed", label: "Get something managed", icon: "📊" },
];

function ServiceCard({ service, reviewData }: { service: ServicePackage; reviewData?: { count: number; avg: number } }) {
  const candidate = service.candidates;
  if (!candidate) return null;

  return (
    <div className="rounded-2xl border border-border-light bg-card overflow-hidden hover:border-text/20 transition-colors group">
      {/* Top — professional info */}
      <div className="bg-[#1C1B1A] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/20">
            {candidate.profile_photo_url ? (
              <img src={candidate.profile_photo_url} alt={candidate.display_name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-white/60">
                {candidate.display_name?.[0] || "?"}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-white truncate">{candidate.display_name}</p>
              {candidate.reputation_tier === "Elite" && (
                <span className="rounded-full bg-amber-700 px-1.5 py-0.5 text-[8px] font-bold text-amber-100">Elite</span>
              )}
              {candidate.reputation_tier === "Top Rated" && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[8px] font-bold text-white">Top Rated</span>
              )}
            </div>
            <p className="text-xs text-white/50">{candidate.role_category}</p>
          </div>
        </div>
      </div>

      {/* Middle — service info */}
      <div className="px-4 py-4">
        <h3 className="text-sm font-semibold text-text line-clamp-2">{service.title}</h3>
        <span className="mt-1.5 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          Delivers in {service.delivery_days} day{service.delivery_days !== 1 ? "s" : ""}
        </span>
        {service.whats_included && service.whats_included.length > 0 && (
          <ul className="mt-2 space-y-1">
            {service.whats_included.slice(0, 3).map((item, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-text-muted">
                <svg className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span className="line-clamp-1">{item}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Bottom — price + actions */}
      <div className="border-t border-border-light bg-gray-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-bold text-text">${Number(service.price_usd).toLocaleString()}</p>
            {reviewData && reviewData.count > 0 && (
              <p className="text-[10px] text-text-tertiary">
                ★ {reviewData.avg} ({reviewData.count} review{reviewData.count !== 1 ? "s" : ""})
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Link
              href={`/candidate/${candidate.id}`}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-white transition-colors"
            >
              Profile
            </Link>
            <Link
              href={`/candidate/${candidate.id}`}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark transition-colors"
            >
              Buy Now
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ServicesBrowse() {
  const [services, setServices] = useState<ServicePackage[]>([]);
  const [featured, setFeatured] = useState<ServicePackage[]>([]);
  const [byCategory, setByCategory] = useState<Record<string, ServicePackage[]>>({});
  const [reviewCounts, setReviewCounts] = useState<Record<string, { count: number; avg: number }>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    loadServices();
  }, [filter]);

  async function loadServices() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter) params.set("category", filter);

    const res = await fetch(`/api/services/browse?${params.toString()}`);
    const data = await res.json();

    setServices(data.services || []);
    setFeatured(data.featured || []);
    setByCategory(data.byCategory || {});
    setReviewCounts(data.reviewCounts || {});
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-3xl sm:text-4xl font-bold text-text">Expert work, delivered.</h1>
        <p className="mt-2 text-text-muted">Pre-vetted professionals. Escrow protected.</p>
        <p className="mt-1 text-xs text-text-tertiary">Every professional offering services on StaffVA passed our vetting process.</p>
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        <button
          onClick={() => setFilter(null)}
          className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${!filter ? "bg-primary text-white" : "bg-gray-100 text-text-muted hover:bg-gray-200"}`}
        >
          All Services
        </button>
        {OUTCOME_SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setFilter(s.key)}
            className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${filter === s.key ? "bg-primary text-white" : "bg-gray-100 text-text-muted hover:bg-gray-200"}`}
          >
            {s.icon} {s.label.replace("Get something ", "")}
          </button>
        ))}
      </div>

      {/* Filtered view */}
      {filter ? (
        <div>
          <h2 className="text-lg font-semibold text-text mb-4">
            {OUTCOME_SECTIONS.find((s) => s.key === filter)?.label || "Services"}
          </h2>
          {services.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {services.map((s) => (
                <ServiceCard
                  key={s.id}
                  service={s}
                  reviewData={reviewCounts[(s.candidates as ServiceCandidate)?.id]}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-text-muted">No services in this category yet.</p>
              <p className="mt-1 text-xs text-text-tertiary">Check back soon — professionals are adding new services regularly.</p>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Featured row */}
          {featured.length > 0 && (
            <div className="mb-10">
              <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider mb-4">Featured — Top Rated Professionals</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {featured.map((s) => (
                  <ServiceCard
                    key={s.id}
                    service={s}
                    reviewData={reviewCounts[(s.candidates as ServiceCandidate)?.id]}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Outcome sections */}
          {OUTCOME_SECTIONS.map((section) => {
            const sectionServices = byCategory[section.key] || [];
            if (sectionServices.length === 0) return null;

            return (
              <div key={section.key} className="mb-10">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-text">{section.icon} {section.label}</h2>
                  <button
                    onClick={() => setFilter(section.key)}
                    className="text-xs text-primary hover:underline"
                  >
                    View all &rarr;
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sectionServices.map((s) => (
                    <ServiceCard
                      key={s.id}
                      service={s}
                      reviewData={reviewCounts[(s.candidates as ServiceCandidate)?.id]}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Empty state */}
          {services.length === 0 && (
            <div className="text-center py-16">
              <svg className="mx-auto h-12 w-12 text-text-tertiary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
              </svg>
              <p className="mt-3 text-text-muted">Services are coming soon.</p>
              <p className="mt-1 text-xs text-text-tertiary">Professionals are building their service packages. Check back soon.</p>
              <Link href="/browse" className="mt-4 inline-block text-sm text-primary hover:underline">
                Browse professionals instead &rarr;
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
