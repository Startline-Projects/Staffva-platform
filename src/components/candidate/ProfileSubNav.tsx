"use client";

import { useEffect, useState } from "react";

/**
 * The Atlas profile sub-nav (step 7): a sticky, numbered row of the sections
 * this profile actually has, with scroll-spy.
 *
 * Atlas hard-codes eight entries — Overview, Video, Skills, Experience,
 * Portfolio, Vetting, Q&A, Reviews — on a page built for one fictional
 * candidate who has all eight. Here the list is whatever the server rendered:
 * a candidate with no portfolio and no reviews gets a shorter nav rather than
 * links to empty anchors. If fewer than two sections exist there is nothing
 * to navigate and the nav does not render at all.
 *
 * Numbers are positional labels, not scores — the prototype's "06 Atlas
 * Vetting Score" is a rank; these are just 01, 02, 03.
 */
export default function ProfileSubNav({
  sections,
}: {
  sections: { id: string; label: string }[];
}) {
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null);

  useEffect(() => {
    if (sections.length < 2) return;

    // Two triggers, one deterministic calculation.
    //
    // The calculation reads every section's position rather than trusting the
    // observer's entry list: an IntersectionObserver only reports sections
    // whose intersection CHANGED, so a scroll producing no new entry leaves
    // the highlight wherever it last landed — which is what happens at the
    // bottom of the page, where the final section never crosses the band.
    //
    // The triggers are both a scroll listener and an observer because neither
    // is sufficient alone: scroll events do not fire in every embedding
    // context, and the observer says nothing while the page is merely
    // resized. Whichever fires, the same function decides.
    let frame = 0;
    const compute = () => {
      frame = 0;
      // Floored: a zero or tiny innerHeight (an unlaid-out or hidden frame)
      // would put the line at 0, where nothing is ever above it and the nav
      // sticks on the first section forever.
      const line = Math.max(120, window.innerHeight * 0.35);
      let current = sections[0]?.id ?? null;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = s.id;
      }
      // At the very bottom the last section wins even if its heading never
      // crosses the line — there is nothing below it to scroll to.
      if (window.innerHeight > 0 && window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) {
        current = sections[sections.length - 1].id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(compute);
    };

    const observer = new IntersectionObserver(schedule, {
      threshold: [0, 0.25, 0.5, 0.75, 1],
    });
    for (const sec of sections) {
      const el = document.getElementById(sec.id);
      if (el) observer.observe(el);
    }

    compute();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    // Clicking a nav item jumps by hash; that must repaint the highlight even
    // where scroll events are unreliable (embedded frames, reduced-motion
    // instant jumps).
    window.addEventListener("hashchange", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", schedule);
    };
  }, [sections]);

  if (sections.length < 2) return null;

  return (
    <nav className="profile-subnav" aria-label="Sections of this profile">
      <div className="container profile-subnav-inner">
        {sections.map((s, i) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={`profile-subnav-item${active === s.id ? " active" : ""}`}
            aria-current={active === s.id ? "true" : undefined}
          >
            <span className="profile-subnav-num" aria-hidden>
              {String(i + 1).padStart(2, "0")}
            </span>
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
