"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ARTICLES,
  CATEGORIES,
  categoryCounts,
  searchArticles,
  type CategoryKey,
} from "@/lib/helpArticles";

/**
 * The Help Center browse screen.
 *
 * Counts come from categoryCounts(), which reads the array. Atlas prints
 * "62 articles across 6 categories" over six hardcoded numbers backed by 12
 * titles and one written body — a number nobody could have checked, and which
 * would have been wrong the first time an article was added or removed.
 */
export default function HelpBrowse() {
  const [q, setQ] = useState("");
  const counts = useMemo(() => categoryCounts(), []);
  const results = useMemo(() => searchArticles(q), [q]);
  const searching = q.trim().length >= 2;

  const byCat = (key: CategoryKey) => ARTICLES.filter((a) => a.category === key);

  return (
    <section className="hc">
      <div className="hc-hero">
        <h1 className="hc-title">How can we help?</h1>
        <p className="hc-lead">
          {ARTICLES.length} articles on how StaffVA actually works — money, contracts, hiring and
          your account.
        </p>
        <div className="hc-search-wrap">
          <input
            className="hc-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search — try escrow, dispute, fee, pause"
            aria-label="Search help articles"
          />
        </div>
      </div>

      {searching ? (
        <div className="hc-results">
          <p className="hc-results-meta">
            {results.length === 0
              ? "No matches"
              : `${results.length} ${results.length === 1 ? "article" : "articles"}`}
          </p>
          {results.length === 0 ? (
            <div className="hc-empty">
              {/* Says what was actually searched. "No results" over a corpus
                  the reader imagines is large reads as "we have nothing on
                  this"; over fifteen articles it means something different. */}
              <p>
                Nothing in these {ARTICLES.length} articles matches
                <strong> {q.trim()}</strong>. That may just mean we have not written it up yet.
              </p>
              <p className="hc-note">
                Email <a href="mailto:support@staffva.com">support@staffva.com</a> and a person
                will answer.
              </p>
            </div>
          ) : (
            <ul className="hc-list">
              {results.map((a) => (
                <li key={a.slug}>
                  <Link href={`/help/${a.slug}`} className="hc-row">
                    <span className="hc-row-title">{a.title}</span>
                    <span className="hc-row-sub">{a.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="hc-cats">
          {CATEGORIES.map((c) => (
            <section key={c.key} className="hc-cat">
              <div className="hc-cat-head">
                <h2>{c.name}</h2>
                <span className="hc-cat-count">
                  {counts[c.key]} {counts[c.key] === 1 ? "article" : "articles"}
                </span>
              </div>
              <p className="hc-cat-desc">{c.desc}</p>
              <ul className="hc-list">
                {byCat(c.key).map((a) => (
                  <li key={a.slug}>
                    <Link href={`/help/${a.slug}`} className="hc-row">
                      <span className="hc-row-title">{a.title}</span>
                      <span className="hc-row-sub">{a.summary}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <div className="hc-contact">
        <h2>Still stuck?</h2>
        <p>
          Email <a href="mailto:support@staffva.com">support@staffva.com</a> and a person will
          read it.
        </p>
        {/* No "avg reply 1 hr", no "within 4 hours", no status widget. None of
            those are measured, so none of them are promised. */}
        <p className="hc-note">
          If it is about money on a specific engagement, include the name of the person you hired
          — it is the fastest way for us to find the right record.
        </p>
      </div>
    </section>
  );
}
