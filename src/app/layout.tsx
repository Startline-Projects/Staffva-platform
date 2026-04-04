import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StaffVA — Vetted Professionals, Ready to Hire",
  description:
    "Browse vetted paralegals, bookkeepers, and admin professionals. Hear voice recordings, verify credentials, and hire through escrow. Free to start.",
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
