"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BLOCK_COPY, type BlockReason } from "@/lib/contractTerms";

/**
 * One agreement: what it says, who has signed it, and — only when it is
 * genuinely signable — a way to sign.
 *
 * The document is rendered in EVERY state, which the page this replaces did not
 * do: it short-circuited to a success card once signed, and offered a PDF
 * download that has never worked because contract_pdf_url is NULL on all eight
 * contracts. An agreement you cannot re-read is not much of a record.
 */
export default function ContractRecord({
  contractId,
  contractHtml,
  blockReason,
  employer,
  clientSignedAt,
  candidateSignedAt,
  engagementAmountUsd,
  engagementBasis,
}: {
  contractId: string;
  contractHtml: string;
  blockReason: BlockReason | null;
  employer: string | null;
  clientSignedAt: string | null;
  candidateSignedAt: string | null;
  engagementAmountUsd: number | null;
  engagementBasis: string | null;
}) {
  const router = useRouter();
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Size the frame to its content, then re-evaluate the scroll gate: a short
  // document must still enable the button.
  function fitFrame() {
    const f = frameRef.current;
    const doc = f?.contentDocument;
    if (!f || !doc) return;
    f.style.height = `${doc.documentElement.scrollHeight}px`;
    setTimeout(handleScroll, 0);
  }

  function handleScroll() {
    const el = docRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) setScrolledToEnd(true);
  }

  // Run once on mount. A contract shorter than its container never fires a
  // scroll event, so without this the button stays disabled forever — the
  // candidate-facing page had exactly that bug while the client-facing modal
  // had the fix.
  useEffect(() => {
    const t = setTimeout(handleScroll, 0);
    return () => clearTimeout(t);
  }, []);

  async function sign() {
    if (signing) return;
    setSigning(true);
    setError(null);
    try {
      const res = await fetch("/api/contracts/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, role: "candidate" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "We couldn't record your signature. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSigning(false);
    }
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("en-US", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : null;

  const block = blockReason ? BLOCK_COPY[blockReason] : null;

  return (
    <div className="space-y-4">
      {/* A terms conflict goes ABOVE the document. Someone should know the
          figures are disputed before they read them, not after. */}
      {blockReason === "terms_conflict" && block && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-900">{block.title}</p>
          <p className="mt-1 text-sm text-red-800">{block.detail}</p>
          {engagementAmountUsd != null && engagementBasis && (
            <p className="mt-2 text-xs text-red-700">
              Your engagement records ${engagementAmountUsd} on a {engagementBasis} basis.
              The document below states an hourly rate, which is not the same thing.
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-xs uppercase tracking-wide text-gray-400">Signatures</p>
        <p className="mt-1 text-sm text-gray-700">
          {employer ?? "The client"}:{" "}
          {clientSignedAt ? (
            <span className="font-medium text-green-700">signed {fmt(clientSignedAt)}</span>
          ) : (
            <span className="text-gray-500">not signed</span>
          )}
        </p>
        <p className="mt-0.5 text-sm text-gray-700">
          You:{" "}
          {candidateSignedAt ? (
            <span className="font-medium text-green-700">signed {fmt(candidateSignedAt)}</span>
          ) : (
            <span className="text-gray-500">not signed</span>
          )}
        </p>
      </div>

      <div
        ref={docRef}
        onScroll={handleScroll}
        className="max-h-[60vh] overflow-y-auto rounded-lg border border-gray-200 bg-white"
      >
        {/* Rendered in a sandbox WITHOUT allow-scripts, so nothing in the
            document can execute.
            An earlier version of this used dangerouslySetInnerHTML with the
            comment "escaped at generation time" — which is false on the primary
            path. lib/contracts.ts returns the model's HTML verbatim; only the
            fallback template escapes its inputs. And the model is prompted with
            clients.company_name, free text with no length cap that the client
            types at signup and nothing validates. next.config.ts ships no CSP,
            so there was nothing downstream to stop it either.
            The frame is sized to its content so the OUTER container keeps
            scrolling, which leaves the read-to-the-end gate below working. */}
        <iframe
          ref={frameRef}
          title="Contract"
          sandbox="allow-same-origin"
          srcDoc={contractHtml}
          onLoad={fitFrame}
          className="w-full border-0"
        />
      </div>

      {blockReason === null ? (
        <div className="rounded-lg border border-[#FE6E3E] bg-orange-50 p-5">
          <p className="text-sm text-gray-700">
            Signing records your agreement to the terms above, with the date and
            your IP address.
          </p>
          <button
            onClick={sign}
            disabled={!scrolledToEnd || signing}
            className="mt-3 rounded-full bg-[#FE6E3E] px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#E55A2B] disabled:opacity-40"
          >
            {signing ? "Signing…" : "I agree — sign this contract"}
          </button>
          {!scrolledToEnd && (
            <p className="mt-2 text-xs text-gray-500">Read to the end of the document to sign.</p>
          )}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        blockReason !== "terms_conflict" &&
        block && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
            <p className="text-sm font-semibold text-[#1C1B1A]">{block.title}</p>
            <p className="mt-1 text-sm text-gray-600">{block.detail}</p>
          </div>
        )
      )}
    </div>
  );
}
