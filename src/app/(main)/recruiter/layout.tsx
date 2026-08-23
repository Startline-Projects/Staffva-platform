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
    // /sign-in does not exist — every other protected route uses /login.
    // Recruiters whose session expired were landing on a 404, and they are
    // the staff who clear the candidate approval backlog.
    redirect("/login?next=/recruiter");
  }

  return <>{children}</>;
}
