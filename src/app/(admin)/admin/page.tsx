"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Metrics {
  liveCandidates: number;
  activeEngagements: number;
  mrr: number;
  candidatesThisWeek: number;
  candidatesThisMonth: number;
  clientsThisWeek: number;
  clientsThisMonth: number;
  totalThreads: number;
  pendingReviews: number;
  activeDisputes: number;
}

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/metrics")
      .then((res) => res.json())
      .then((data) => {
        setMetrics(data);
        setLoading(false);
      });
  }, []);

  if (loading || !metrics) {
    return <p className="text-text/60">Loading dashboard...</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text">Platform Dashboard</h1>

      {/* Pending reviews alert */}
      {metrics.pendingReviews > 0 && (
        <Link
          href="/admin/candidates"
          className="mt-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 hover:bg-amber-100 transition-colors"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-200 text-sm font-bold text-amber-800">
            {metrics.pendingReviews}
          </span>
          <span className="text-sm font-medium text-amber-800">
            candidates pending speaking review
          </span>
          <span className="ml-auto text-xs text-amber-600">
            Review now &rarr;
          </span>
        </Link>
      )}

      {/* Key metrics */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-card p-5">
          <p className="text-xs font-medium text-text/40 uppercase tracking-wider">
            Live Candidates
          </p>
          <p className="mt-2 text-3xl font-bold text-text">
            {metrics.liveCandidates}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-card p-5">
          <p className="text-xs font-medium text-text/40 uppercase tracking-wider">
            Active Engagements
          </p>
          <p className="mt-2 text-3xl font-bold text-text">
            {metrics.activeEngagements}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-card p-5">
          <p className="text-xs font-medium text-text/40 uppercase tracking-wider">
            Monthly Revenue (MRR)
          </p>
          <p className="mt-2 text-3xl font-bold text-primary">
            ${metrics.mrr.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-card p-5">
          <p className="text-xs font-medium text-text/40 uppercase tracking-wider">
            Message Threads
          </p>
          <p className="mt-2 text-3xl font-bold text-text">
            {metrics.totalThreads}
          </p>
        </div>
      </div>

      {/* Activity */}
      <h2 className="mt-8 text-lg font-semibold text-text">Recent Activity</h2>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-card p-4">
          <p className="text-xs text-text/40">New Candidates (Week)</p>
          <p className="mt-1 text-xl font-bold text-text">
            {metrics.candidatesThisWeek}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-card p-4">
          <p className="text-xs text-text/40">New Candidates (Month)</p>
          <p className="mt-1 text-xl font-bold text-text">
            {metrics.candidatesThisMonth}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-card p-4">
          <p className="text-xs text-text/40">New Clients (Week)</p>
          <p className="mt-1 text-xl font-bold text-text">
            {metrics.clientsThisWeek}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-card p-4">
          <p className="text-xs text-text/40">New Clients (Month)</p>
          <p className="mt-1 text-xl font-bold text-text">
            {metrics.clientsThisMonth}
          </p>
        </div>
      </div>

      {/* Disputes */}
      {metrics.activeDisputes > 0 && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-5 py-3 flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-200 text-sm font-bold text-red-800">
            {metrics.activeDisputes}
          </span>
          <span className="text-sm font-medium text-red-800">
            active {metrics.activeDisputes === 1 ? "dispute" : "disputes"} awaiting resolution
          </span>
        </div>
      )}
    </div>
  );
}
