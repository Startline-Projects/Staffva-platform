"use client";

import { useEffect } from "react";

/**
 * The profile page's behavior layer: the floating hire pill appears once the
 * reader scrolls past the hero, and the nav hamburger opens the mobile menu
 * (same wiring the homepage gets from LandingInteractive).
 */
export default function ProfileInteractive() {
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    const pill = document.querySelector(".profile-sticky-footer");
    if (pill) {
      const onScroll = () => {
        pill.classList.toggle("visible", window.scrollY > 600);
      };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      cleanups.push(() => window.removeEventListener("scroll", onScroll));
    }

    const hamburger = document.querySelector(".lp .hamburger");
    const nav = document.querySelector(".lp .nav");
    if (hamburger && nav) {
      const toggle = () => nav.classList.toggle("nav-open");
      hamburger.addEventListener("click", toggle);
      cleanups.push(() => hamburger.removeEventListener("click", toggle));
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);
  return null;
}
