import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { ARTICLES, articleBySlug } from "@/lib/helpArticles";
import HelpArticleView from "@/components/client/portal/HelpArticleView";

/**
 * One help article.
 *
 * Atlas renders the SAME body for every slug — twelve titles, one article,
 * and no 404 for the eleven that do not exist. Here an unknown slug is a
 * genuine 404, and every slug that resolves has a written body.
 */
export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getUser();
  if (!user) redirect(`/login?next=/help/${encodeURIComponent(slug)}`);

  const article = articleBySlug(slug);
  if (!article) notFound();

  return <HelpArticleView article={article} />;
}
