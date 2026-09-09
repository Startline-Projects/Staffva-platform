"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * The mobile drawer state, shared by the rail (which slides) and the topbar
 * (which owns the hamburger). PortalFrame takes the two as separate props, so
 * they cannot hold the state between them — it lives here, above the frame.
 */
const DrawerContext = createContext<{
  open: boolean;
  setOpen: (v: boolean) => void;
} | null>(null);

export function AdminDrawerProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  /**
   * The drawer remembers the route it was opened on rather than a bare
   * boolean, so navigating closes it by definition instead of by an effect
   * that fires a second render after the new page is already on screen.
   */
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath !== null && openPath === pathname;

  const setOpen = useCallback(
    (v: boolean) => setOpenPath(v ? pathname : null),
    [pathname]
  );

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const value = useMemo(() => ({ open, setOpen }), [open, setOpen]);
  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}

export function useAdminDrawer() {
  const ctx = useContext(DrawerContext);
  if (!ctx) throw new Error("useAdminDrawer must be used inside AdminDrawerProvider");
  const { open, setOpen } = ctx;
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  const close = useCallback(() => setOpen(false), [setOpen]);
  return { open, toggle, close };
}
