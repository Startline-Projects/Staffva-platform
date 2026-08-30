import { redirect } from "next/navigation";

// The static four-step wizard that lived here is replaced by the AI composer.
// The shortlist under /post-role/shortlist is still the post-publish landing.
export default function PostRoleRedirect() {
  redirect("/post-a-job");
}
