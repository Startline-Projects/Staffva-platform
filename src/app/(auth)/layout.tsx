import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Image src="/logo.svg" alt="StaffVA" width={140} height={50} />
          </Link>
        </div>
        <div className="rounded-xl border border-gray-200 bg-card p-8 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
