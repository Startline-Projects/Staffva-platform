import Link from "next/link";
import { ARTICLES, CATEGORIES, type Block, type HelpArticle } from "@/lib/helpArticles";

/**
 * One article.
 *
 * A server component: there is nothing interactive here. Atlas's article
 * footer carries "Was this helpful?" thumbs that fire a toast and store
 * nothing, and a table of contents; neither is worth a client bundle for a
 * page this length.
 */
function renderBlock(b: Block, i: number) {
  switch (b.kind) {
    case "h":
      return <h2 key={i} className="hc-a-h">{b.text}</h2>;
    case "p":
      return <p key={i} className="hc-a-p">{b.text}</p>;
    case "ul":
      return (
        <ul key={i} className="hc-a-ul">
          {b.items.map((t, j) => <li key={j}>{t}</li>)}
        </ul>
      );
    case "ol":
      return (
        <ol key={i} className="hc-a-ol">
          {b.items.map((t, j) => <li key={j}>{t}</li>)}
        </ol>
      );
    case "note":
      return <p key={i} className="hc-a-note">{b.text}</p>;
  }
}

export default function HelpArticleView({ article }: { article: HelpArticle }) {
  const cat = CATEGORIES.find((c) => c.key === article.category);
  const related = ARTICLES.filter(
    (a) => a.category === article.category && a.slug !== article.slug
  ).slice(0, 3);

  return (
    <article className="hc-a">
      <nav className="hc-a-crumb">
        <Link href="/help">Help</Link>
        <span aria-hidden="true"> / </span>
        <span>{cat?.name}</span>
      </nav>

      <h1 className="hc-a-title">{article.title}</h1>
      {/* No read time and no "Updated <date>". Nothing tracks either, and a
          made-up freshness date on a help article is the kind of small lie
          that decides whether someone trusts the rest of it. */}
      <p className="hc-a-lead">{article.summary}</p>

      <div className="hc-a-body">{article.body.map(renderBlock)}</div>

      {related.length > 0 && (
        <div className="hc-a-related">
          <h2>More on {cat?.name.toLowerCase()}</h2>
          <ul className="hc-list">
            {related.map((a) => (
              <li key={a.slug}>
                <Link href={`/help/${a.slug}`} className="hc-row">
                  <span className="hc-row-title">{a.title}</span>
                  <span className="hc-row-sub">{a.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="hc-contact">
        <h2>Did this not answer it?</h2>
        <p>
          Email <a href="mailto:support@staffva.com">support@staffva.com</a>. Tell us what you
          were trying to do and we will fix the article as well as answer you.
        </p>
      </div>
    </article>
  );
}
