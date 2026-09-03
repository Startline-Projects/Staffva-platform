"use client";

import { useEffect } from "react";

/**
 * The landing page's behavior layer, ported from the prototype's script:
 * scroll-reveal (adds .in), the savings calculator, carousel arrows, FAQ
 * accordion, and a small mobile-menu toggle. All inside the .lp scope.
 */
export default function LandingInteractive() {
  useEffect(() => {
    const root = document.querySelector(".lp");
    if (!root) return;
    const cleanups: (() => void)[] = [];

    // Scroll reveal
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -80px 0px" }
    );
    root.querySelectorAll(".reveal, .reveal-stagger").forEach((el) => observer.observe(el));
    cleanups.push(() => observer.disconnect());

    // Savings calculator (10% of annual spend vs a typical 20% marketplace)
    const rateSlider = document.getElementById("rateSlider") as HTMLInputElement | null;
    const hoursSlider = document.getElementById("hoursSlider") as HTMLInputElement | null;
    const rateVal = document.getElementById("rateVal");
    const hoursVal = document.getElementById("hoursVal");
    const savingVal = document.getElementById("savingVal");
    function updateCalc() {
      if (!rateSlider || !hoursSlider || !rateVal || !hoursVal || !savingVal) return;
      const rate = parseInt(rateSlider.value, 10);
      const hours = parseInt(hoursSlider.value, 10);
      rateVal.textContent = "$" + rate;
      hoursVal.textContent = String(hours);
      savingVal.textContent = "$" + Math.round(rate * hours * 52 * 0.1).toLocaleString();
    }
    if (rateSlider && hoursSlider) {
      rateSlider.addEventListener("input", updateCalc);
      hoursSlider.addEventListener("input", updateCalc);
      updateCalc();
      cleanups.push(() => {
        rateSlider.removeEventListener("input", updateCalc);
        hoursSlider.removeEventListener("input", updateCalc);
      });
    }

    // Carousel arrows
    const carousel = document.getElementById("carousel");
    root.querySelectorAll(".carousel-arrow").forEach((btn, i) => {
      const handler = () => carousel?.scrollBy({ left: (i === 0 ? -1 : 1) * 320, behavior: "smooth" });
      btn.addEventListener("click", handler);
      cleanups.push(() => btn.removeEventListener("click", handler));
    });

    // FAQ accordion (one open at a time)
    root.querySelectorAll(".faq-item").forEach((item) => {
      const head = item.querySelector(".faq-q");
      if (!head) return;
      const handler = () => {
        const wasOpen = item.classList.contains("open");
        root.querySelectorAll(".faq-item").forEach((x) => x.classList.remove("open"));
        if (!wasOpen) item.classList.add("open");
      };
      head.addEventListener("click", handler);
      cleanups.push(() => head.removeEventListener("click", handler));
    });

    // Mobile menu
    const hamburger = root.querySelector(".hamburger");
    const nav = root.querySelector(".nav");
    if (hamburger && nav) {
      const handler = () => nav.classList.toggle("nav-open");
      hamburger.addEventListener("click", handler);
      cleanups.push(() => hamburger.removeEventListener("click", handler));
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
