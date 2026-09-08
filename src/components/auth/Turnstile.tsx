"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Cloudflare Turnstile, shared by every auth surface (candidate signup,
 * client signup, login, forgot-password). The widget renders ONLY when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is configured — with no vendor behind it
 * there is no checkbox, because a captcha that verifies nothing is a fake
 * security control.
 *
 * Supabase verifies tokens project-wide or not at all: once captcha
 * enforcement is enabled in the Supabase dashboard, EVERY auth call must
 * carry a token. All four surfaces above send one, so enforcement can be
 * turned on — but confirm the MFA challenge/verify and signup-resend flows
 * against Supabase's current captcha scope before flipping it.
 *
 * Tokens are single-use: call reset() after a consumed attempt when the user
 * stays on the same form. A container that unmounts cleans itself up.
 *
 * If the Cloudflare script cannot load (ad-blocker, corporate proxy, CDN
 * outage), `loadFailed` flips true and callers must let the submit proceed
 * WITHOUT a token — otherwise the page is an unrecoverable dead end pointing
 * at an empty div. With Supabase enforcement on, the server still rejects
 * the tokenless call; the failure surfaces as its error instead of silence.
 *
 * containerRef is a callback ref on purpose: pages mount the container
 * conditionally (login only shows it in the default state), so the widget
 * must render every time the node attaches, and remove itself on detach.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const LOAD_TIMEOUT_MS = 15000;

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove?: (widgetId: string) => void;
    };
  }
}

// Module-level so four auth surfaces share one script load per JS session.
let scriptPromise: Promise<boolean> | null = null;

function ensureScript(): Promise<boolean> {
  if (window.turnstile) return Promise.resolve(true);
  if (!scriptPromise) {
    scriptPromise = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), LOAD_TIMEOUT_MS);
      const done = (ok: boolean) => { clearTimeout(timer); resolve(ok && !!window.turnstile); };
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
      if (existing) {
        // Injected by something outside this module. If its load already
        // fired, the timeout is the fallback that settles us.
        existing.addEventListener("load", () => done(true), { once: true });
        existing.addEventListener("error", () => done(false), { once: true });
        return;
      }
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.onload = () => done(true);
      s.onerror = () => done(false);
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export function useTurnstile() {
  const [loadFailed, setLoadFailed] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    // StrictMode re-attaches the same node; don't render a second widget.
    if (node === nodeRef.current) return;
    if (!node) {
      if (widgetIdRef.current !== null) {
        try { window.turnstile?.remove?.(widgetIdRef.current); } catch {}
      }
      nodeRef.current = null;
      widgetIdRef.current = null;
      tokenRef.current = null;
      return;
    }
    nodeRef.current = node;
    tokenRef.current = null;
    widgetIdRef.current = null;
    if (!SITE_KEY) return;
    ensureScript().then((ok) => {
      if (!ok) { setLoadFailed(true); return; }
      // The node may have detached (or already gotten a widget) while the
      // script loaded.
      if (nodeRef.current !== node || widgetIdRef.current !== null || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(node, {
        sitekey: SITE_KEY,
        callback: (token) => { tokenRef.current = token; },
        "expired-callback": () => { tokenRef.current = null; },
      });
    });
  }, []);

  const reset = useCallback(() => {
    if (window.turnstile && widgetIdRef.current !== null) {
      try { window.turnstile.reset(widgetIdRef.current); } catch {}
    }
    tokenRef.current = null;
  }, []);

  return { configured: !!SITE_KEY, loadFailed, containerRef, tokenRef, reset };
}
