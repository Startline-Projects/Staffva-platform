import type { NextConfig } from "next";

// Baseline security headers. Deliberately excludes Content-Security-Policy:
// a useful CSP for this app needs per-request nonces wired through the proxy,
// and a half-configured one either breaks the app or provides false comfort.
// That is worth doing as its own change, with the pages exercised afterwards.
const securityHeaders = [
  // The app is HTTPS-only in production; stop protocol-downgrade attempts.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  // Never let the browser second-guess a declared Content-Type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking: nothing here is meant to be embedded.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Don't leak full URLs (which carry ids) to third parties.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Candidates record a video introduction, so camera + microphone must stay
  // available to this origin. Everything else is denied.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
