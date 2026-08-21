import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";

export default async function RecruiterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  const role = user?.app_metadata?.role;

  if (!user || (role !== "recruiter" && role !== "admin" && role !== "recruiting_manager")) {
    redirect("/sign-in");
  }

  return <>{children}</>;
}
