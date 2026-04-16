'use client';

import { useState } from 'react';

const FAQ_ITEMS = [
  {
    question: 'How is StaffVA different from other hiring platforms?',
    answer: `<p>Three things set us apart. <strong>Every candidate records two live voice samples during vetting</strong> — a self-introduction and a reading passage. You can hear them before you ever message. Second, <strong>every candidate passes two interviews</strong> — an AI-led first interview and a live recruiter interview. Third, <strong>candidates never pay a fee</strong>. That means the best professionals stay on the platform because leaving makes no economic sense for them.</p>`,
  },
  {
    question: 'What does it cost to hire someone?',
    answer: `<p>Browsing, messaging, and viewing profiles is free. When you're ready to hire, you see the total cost upfront on the checkout screen — the professional's rate plus the service total. <strong>Your payment is held in escrow until you approve delivery.</strong> No subscription. No monthly minimums. You only pay when work is happening.</p>`,
  },
  {
    question: 'How are candidates vetted?',
    answer: `<p>Every candidate goes through a five-step vetting process before their profile goes live. It starts with a <strong>college degree requirement</strong>, followed by a timed <strong>English grammar and comprehension test</strong> with anti-cheat measures, two <strong>live voice recordings</strong> reviewed by a human, <strong>government ID verification</strong> via Stripe Identity, and a <strong>two-interview process</strong> — one AI-led and one with our recruiting team.</p><p>Under 30% of applicants make it through. Every badge you see on a profile is locked and cannot be edited by the candidate.</p>`,
  },
  {
    question: "What happens if the hire doesn't work out?",
    answer: `<p>You have a <strong>48-hour dispute window</strong> after every payment cycle or milestone. If something is off, you raise it before funds release. Our dispute team reviews evidence from both sides and makes a ruling.</p><p>You can also end any engagement at any time — <strong>no notice period, no cancellation fees</strong>. If a hire isn't the right fit, you move on and hire someone else. Nothing locks you in.</p>`,
  },
  {
    question: 'How long does it take to hire someone?',
    answer: `<p>As fast as you want it to be. You don't have to post a job and wait for applicants — <strong>all candidates are already vetted and browsable</strong>. Most clients listen to a few voice samples, message their top 2 or 3, and hire within a day or two. The slowest part of the process is usually the client's own calendar.</p>`,
  },
  {
    question: 'Can I interview a candidate before I commit?',
    answer: `<p>Yes, and you have more information than any other platform gives you. Every candidate profile shows their <strong>two voice samples</strong>, their <strong>interview scorecard</strong> from our recruiting team (covering communication clarity, professional demeanor, and role knowledge), and their <strong>AI interview tier</strong>.</p><p>After that, messaging is free. You can ask questions, request a call, or send a small paid project before committing to an ongoing role.</p>`,
  },
  {
    question: 'How do I pay — what currencies and cards are accepted?',
    answer: `<p>All payments run through <strong>Stripe</strong>. We accept all major credit and debit cards — Visa, Mastercard, American Express, Discover. All transactions are in <strong>USD</strong>, and funds are held in escrow until you release them.</p>`,
  },
  {
    question: 'What if I need to pause or end the engagement?',
    answer: `<p>End it whenever. <strong>No notice period, no early-termination fees, no questions asked.</strong> Any funds already captured for an upcoming cycle that hasn't started yet are refunded. If you need to pause and come back, message the professional directly — most are happy to hold the role open if they know your timeline.</p>`,
  },
];

export default function FaqAccordion() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <div className="faq-list">
      {FAQ_ITEMS.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div
            key={i}
            className={`faq-item${isOpen ? ' open' : ''}`}
          >
            <button
              className="faq-question"
              aria-expanded={isOpen}
              onClick={() => setOpenIndex(isOpen ? -1 : i)}
              type="button"
            >
              <span>{item.question}</span>
              <span className="faq-icon" aria-hidden="true" />
            </button>
            <div className="faq-answer">
              <div
                className="faq-answer-inner"
                dangerouslySetInnerHTML={{ __html: item.answer }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
