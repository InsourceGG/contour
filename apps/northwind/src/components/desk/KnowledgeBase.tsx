import type { KbArticle } from "@/data/types";
import { PanelState, shortDate, type DataStateProps } from "./shared";

export interface KnowledgeBaseProps extends DataStateProps {
  articles: KbArticle[];
  mode?: "guided" | "collapsed";
}

/** Expandable team guidance, with a more explicit first article for new agents. */
export function KnowledgeBase({ articles, mode = "guided", loading, error, className = "" }: KnowledgeBaseProps) {
  return <section className={`desk-panel knowledge-base kb-${mode} ${className}`} aria-labelledby="kb-heading" aria-busy={loading}>
    <header className="desk-panel-header"><div><h2 id="kb-heading">Knowledge base</h2><p>{mode === "guided" ? "Practical answers for your next reply." : "Team reference articles"}</p></div><span className="desk-count desk-number">{articles.length}</span></header>
    <PanelState loading={loading} error={error} empty={!articles.length} emptyTitle="No articles in this team yet" emptyDescription="Your team’s reference articles will appear here when they are added.">
      <div className="kb-articles">{articles.map((article, index) => <details className="kb-article" key={article.id} open={mode === "guided" && index === 0}>
        <summary><span><strong>{article.title}</strong>{mode === "guided" && <span className="kb-summary">{article.summary}</span>}</span><span className="kb-read-time desk-number">{article.readMinutes} min</span></summary>
        <div className="kb-body"><div className="kb-meta"><span className="desk-chip">{article.topic}</span><span>Updated {shortDate(article.updatedAt)}</span></div>{article.body.split(/\n\n+/).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</div>
      </details>)}</div>
    </PanelState>
  </section>;
}
