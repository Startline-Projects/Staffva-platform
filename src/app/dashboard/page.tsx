import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";

/**
 * /dashboard is the one link the Atlas nav can offer without knowing the
 * viewer's role — this route looks the role up and forwards to the home
 * that role actually has.
 */
export default async function DashboardRedirect() {
  const user = await getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;
  if (role === "candidate") redirect("/candidate/dashboard");
  if (role === "admin") redirect("/admin");
  if (role === "recruiting_manager" || role === "recruiter") redirect("/recruiter");
  redirect("/team");
}
