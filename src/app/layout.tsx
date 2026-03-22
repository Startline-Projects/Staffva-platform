import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StaffVA — Pre-Vetted Offshore Talent Marketplace",
  description:
    "Browse pre-vetted offshore paralegals, bookkeepers, admins, and legal assistants. Free to browse. You only pay when you hire.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-background text-text">
        {children}
      </body>
    </html>
  );
}
