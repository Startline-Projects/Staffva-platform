import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StaffVA — Remote Professionals, Ready to Hire",
  description:
    "Browse paralegals, bookkeepers, and admin professionals. Hear voice recordings, see who carries our Vetted badge, and hire through escrow. Free to start.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-background text-text">
        {children}
      </body>
    </html>
  );
}
