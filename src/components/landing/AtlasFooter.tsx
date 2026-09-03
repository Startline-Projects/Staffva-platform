import Link from "next/link";
import StaffvaLogo from "@/components/landing/StaffvaLogo";

/** The Atlas-design footer — shared by the homepage and browse. */
export default function AtlasFooter() {
  return (
    <>
<footer>
  <div className="container">
    <div className="footer-top">
      <div className="footer-brand">
        <Link href="/" className="logo"><StaffvaLogo /></Link>
        <p className="footer-tagline">The global talent marketplace for companies who actually want A-players.</p>
      </div>

      <div className="footer-col">
        <h4>Clients</h4>
        <ul>
          <li><a href="/browse">Browse Talent</a></li>
          <li><a href="/post-a-job">Post a Job</a></li>
          <li><a href="/signup/client">For Businesses</a></li>
          <li><Link href="/#pricing">Pricing</Link></li>
        </ul>
      </div>

      <div className="footer-col">
        <h4>Candidates</h4>
        <ul>
          <li><a href="/signup/candidate">Apply to Join</a></li>
          <li><Link href="/#vetting">How Vetting Works</Link></li>
          <li><a href="/login">Sign In</a></li>
        </ul>
      </div>

      <div className="footer-col">
        <h4>Resources</h4>
        <ul>
          <li><a href="/terms">Trust &amp; Safety</a></li>
          <li><a href="/privacy">Privacy</a></li>
          <li><a href="/cookies">Cookie Policy</a></li>
        </ul>
      </div>

      <div className="footer-col">
        <h4>Company</h4>
        <ul>
          <li><a href="mailto:hello@staffva.com">Contact</a></li>
          <li><a href="/terms">Terms of Service</a></li>
        </ul>
      </div>
    </div>

    <div className="footer-bottom">
      <div>© 2026 Stafva LLC · <a href="/terms" style={{color:"#ddd",borderBottom:"1px solid #333",paddingBottom:"1px"}}>Terms</a> · <a href="/privacy" style={{color:"#ddd",borderBottom:"1px solid #333",paddingBottom:"1px"}}>Privacy</a> · <a href="/cookies" style={{color:"#ddd",borderBottom:"1px solid #333",paddingBottom:"1px"}}>Cookies</a></div>
    </div>
  </div>
</footer>
    </>
  );
}
