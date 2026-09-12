/**
 * The one sign-out control both portal rails and the client topbar use.
 * It posts to /auth/signout, which clears the Supabase session server-side
 * and redirects to /login.
 *
 * It lives in the topbar as well as the sidebar footer because that footer
 * is hidden below 880px, where the rail becomes a bottom bar — without a
 * topbar copy, a client on a phone has no way to sign out at all. Many
 * people here work from shared machines; sign-out is never allowed to be a
 * scavenger hunt.
 */
export default function PortalSignOut({
  className,
  label,
}: {
  className?: string;
  /** Renders as a labelled menu row instead of the bare icon. Same form, same
   *  endpoint — the account menu must not introduce a second way to sign out. */
  label?: string;
}) {
  return (
    <form action="/auth/signout" method="POST" style={label ? { display: "block" } : undefined}>
      <button
        type="submit"
        className={className}
        aria-label="Sign out"
        title="Sign out"
        style={
          label
            ? undefined
            : { display: "flex", alignItems: "center", padding: 6, borderRadius: 6, color: "var(--ink-mute)" }
        }
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6 2H3.5A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14H6M10.5 11.5 14 8l-3.5-3.5M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {label && <span>{label}</span>}
      </button>
    </form>
  );
}
