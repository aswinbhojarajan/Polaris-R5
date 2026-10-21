import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import { safeSourceUrl, validateGeneration, type SearchEvidence } from "@shared/native-web-search";

interface Props { runId: string; itemId: string; text?: string; enabled: boolean }
type Detail = { phase: string; evidence: SearchEvidence | null; answerText?: string | null; runStatus?: string };

/** Escaped answer text with provider-mapped inline links, never raw HTML. */
export function NativeSearchAnswer({ runId, itemId, text, enabled }: Props) {
  const detail = useQuery<Detail>({
    queryKey: ["/api/v1/prompt-runs", runId, "search-evidence", itemId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/prompt-runs/${runId}/search-evidence/${itemId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Search evidence could not be loaded.");
      return response.json();
    },
    enabled,
    refetchInterval: query => query.state.data?.evidence ||
      ["done", "completed_with_errors", "error", "cancelled", "paused"].includes(query.state.data?.runStatus ?? "") ?
      false : ["not_started", "generating", "generated", "scoring"].includes(query.state.data?.phase ?? "") ? 5000 : false,
  });
  const answerText = text || detail.data?.answerText || "";
  const evidence = useMemo(() => {
    if (!detail.data?.evidence) return null;
    try { return validateGeneration({ answerText: answerText || null, evidence: detail.data.evidence }).evidence; }
    catch { return null; }
  }, [detail.data, answerText]);
  if (!enabled) return <p className="text-sm whitespace-pre-wrap">{text}</p>;
  if (detail.isLoading) return <p className="text-xs text-muted-foreground">Loading search attribution…</p>;
  if (detail.isError) return <p role="alert" className="text-xs text-destructive">
    Search attribution could not be loaded. This grounded answer is unavailable until its sources can be verified.
    {" "}<button type="button" className="underline" onClick={() => detail.refetch()}>Retry</button>
  </p>;
  const status = evidence?.invocationStatus;
  const label = status === "invoked" ? "Search used" : status === "not_invoked" ? "Available—not used" :
    status === "failed" ? "Search failed" : detail.isError ? "Evidence unavailable" :
      !detail.data?.evidence && ["not_started", "generating"].includes(detail.data?.phase ?? "") &&
      !["done", "completed_with_errors", "error", "cancelled"].includes(detail.data?.runStatus ?? "") ? "Search pending" : "Unknown";
  const citations = evidence?.citations ?? [];
  if ((detail.data?.evidence || answerText) && !evidence) return <p role="alert" className="text-sm text-destructive">
    Required search attribution could not be verified. This grounded answer is unavailable until its evidence is repaired.
  </p>;
  const sources = evidence?.sources ?? [];
  const ends = Array.from(new Set(citations.map(c => c.textEnd))).sort((a, b) => a - b);
  let previous = 0;
  const rendered = ends.map(end => {
    const chunk = answerText.slice(previous, end); previous = end;
    const sourceIds = Array.from(new Set(citations.filter(c => c.textEnd === end).flatMap(c => c.sourceIds)));
    return <span key={end}>{chunk}{sourceIds.map(id => {
      const source = sources.find(s => s.id === id);
      const url = source && safeSourceUrl(source.url);
      return url ? <a key={id} href={url} target="_blank" rel="noopener noreferrer"
        className="text-primary underline ml-1 inline-flex items-baseline gap-0.5" aria-label={source.title ?? "Cited source"}>
        <sup>[{sources.filter(s => s.kind === "cited").findIndex(s => s.id === id) + 1}]</sup><ExternalLink className="h-2.5 w-2.5" />
      </a> : null;
    })}</span>;
  });
  return <div className="space-y-3" data-testid={`native-search-answer-${itemId}`}>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span>Web search enabled for this run</span>
      <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1"><Search className="h-3 w-3" />{label}</span>
    </div>
    {evidence && <p className="text-xs text-muted-foreground">
      Requested model: {evidence.requestedModel}.{" "}
      {evidence.actualModel ? `Model reported by provider: ${evidence.actualModel}` : "Reported model identity unavailable."}
    </p>}
    {answerText && evidence && <p className="text-sm whitespace-pre-wrap">{rendered}{answerText.slice(previous)}</p>}
    {!text && ["generated", "scoring"].includes(detail.data?.phase ?? "") && <p className="text-xs text-muted-foreground">
      Answer saved. Scoring has not finished.
    </p>}
    {evidence?.error && <p role="alert" className="text-xs text-destructive">{evidence.error.message}</p>}
    {(["cited", "consulted"] as const).map(kind => {
      const list = sources.filter(source => source.kind === kind);
      return list.length > 0 && <section key={kind} className="space-y-1">
        <h4 className="text-sm font-medium">{kind === "cited" ? "Cited sources" : "Other sources consulted"}</h4>
        <p className="text-xs text-muted-foreground">{kind === "cited" ? "Sources linked directly in the answer" : "Reviewed during search, not cited in the answer"}</p>
        <ul className="divide-y rounded-md border">{list.map((source, index) => {
          const url = safeSourceUrl(source.url);
          return url && <li key={source.id}><a href={url} target="_blank" rel="noopener noreferrer"
            className="flex items-start justify-between gap-2 p-2 text-xs hover:underline break-all">
            <span>{kind === "cited" && `[${index + 1}] `}{source.title ?? new URL(url).hostname}
              <small className="block text-muted-foreground">{new URL(url).hostname}</small></span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a></li>;
        })}</ul>
      </section>;
    })}
  </div>;
}
