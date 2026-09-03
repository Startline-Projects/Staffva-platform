import Link from "next/link";

/** The Atlas-design site nav — shared by the homepage and browse. */
export default function AtlasNav() {
  return (
    <>
<nav className="nav" id="nav">
  <div className="nav-inner">
    <Link href="/" className="logo">
      <span className="logo-mark"></span>
      <span>StaffVA</span>
    </Link>
    <div className="nav-links">
      <a href="/browse" className="nav-link">Find Talent</a>
      <a href="/signup/client" className="nav-link">For Businesses</a>
      <a href="/signup/candidate" className="nav-link">For Candidates</a>
      <Link href="/#vetting" className="nav-link">How It Works</Link>
      <Link href="/#pricing" className="nav-link">Pricing</Link>
    </div>
    <div className="nav-actions">
      <a href="/login" className="btn btn-ghost">Sign In</a>
      <a href="/signup/client" className="btn btn-primary">Sign Up</a>
      <button className="hamburger" aria-label="Menu">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
      </button>
    </div>
  </div>
</nav>
    </>
  );
}
