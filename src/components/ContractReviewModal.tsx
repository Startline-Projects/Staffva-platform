"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface Props {
  contractId: string;
  contractHtml: string;
  onSigned: () => void;
  onClose: () => void;
}

export default function ContractReviewModal({ contractId, contractHtml, onSigned, onClose }: Props) {
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) {
      setHasScrolledToBottom(true);
    }
  }, []);

  // A short contract that fits without scrolling never fires a scroll
  // event — the sign button would stay locked forever.
  useEffect(() => {
    const t = setTimeout(handleScroll, 0);
    return () => clearTimeout(t);
  }, [handleScroll]);

  async function handleSign() {
    setSigning(true);
    setError("");

    try {
      const res = await fetch("/api/contracts/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, role: "client" }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to sign contract");
        setSigning(false);
        return;
      }

      setSigned(true);
      setTimeout(() => onSigned(), 2000);
    } catch {
      setError("Something went wrong. Please try again.");
      setSigning(false);
    }
  }

  if (signed) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="mx-auto max-w-md rounded-2xl bg-card p-8 text-center shadow-2xl">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-text">Contract Signed</h2>
          <p className="mt-2 text-sm text-text-muted">
            The contract has been sent to the contractor for their signature. You&apos;ll be notified when it&apos;s fully executed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/60 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-text">Independent Contractor Agreement</h2>
          <p className="text-xs text-text-muted">Review the contract below and scroll to the bottom to sign</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-text/40 hover:bg-gray-100 hover:text-text transition-colors"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Contract body */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-gray-50"
      >
        <div className="mx-auto max-w-3xl px-8 py-8">
          <div
            className="rounded-xl border border-border-light bg-white p-8 shadow-sm"
            dangerouslySetInnerHTML={{ __html: contractHtml }}
          />
        </div>
      </div>

      {/* Scroll indicator */}
      {!hasScrolledToBottom && (
        <div className="pointer-events-none absolute bottom-20 left-0 right-0 flex justify-center">
          <div className="flex items-center gap-2 rounded-full bg-charcoal/80 px-4 py-2 text-xs text-white shadow-lg">
            <svg className="h-4 w-4 animate-bounce" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
            </svg>
            Scroll to bottom to enable signing
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-border bg-card px-6 py-4 shadow-up">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <p className="text-xs text-text-muted">
            By signing, you agree to the terms of this Independent Contractor Agreement.
          </p>
          <div className="flex items-center gap-3">
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSign}
              disabled={!hasScrolledToBottom || signing}
              className="rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {signing ? "Signing..." : "Sign Contract"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
