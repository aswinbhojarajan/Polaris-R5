import { validateGeneration, type SearchEvidence } from "./native-web-search";

/** Human-facing export only. Never pass this attributed text into a scorer. */
export function formatNativeAnswerForDisplay(answer: string, evidence?: SearchEvidence): string {
  if (!evidence) return answer;
  const checked = validateGeneration({ answerText: answer, evidence }).evidence;
  if (checked.error) throw new Error("A failed native generation cannot be exported as a successful answer.");
  const cited = checked.sources.filter(source => source.kind === "cited");
  const ends = Array.from(new Set(checked.citations.map(citation => citation.textEnd))).sort((a, b) => b - a);
  let displayed = answer;
  for (const end of ends) {
    const sourceIds = Array.from(new Set(checked.citations.filter(citation => citation.textEnd === end)
      .flatMap(citation => citation.sourceIds)));
    const markers = sourceIds.map(id => {
      const index = cited.findIndex(source => source.id === id);
      return ` [${index + 1}](${cited[index].url})`;
    }).join("");
    displayed = displayed.slice(0, end) + markers + displayed.slice(end);
  }
  let attribution = `\n\nWeb search: ${checked.invocationStatus === "invoked" ? "Used" :
    checked.invocationStatus === "not_invoked" ? "Available—not used" : "Unknown"}`;
  if (checked.actualModel) attribution += `\nModel reported by provider: ${checked.actualModel}`;
  for (const kind of ["cited", "consulted"] as const) {
    const sources = checked.sources.filter(source => source.kind === kind);
    if (!sources.length) continue;
    attribution += `\n\n${kind === "cited" ? "Cited sources" : "Other sources consulted"}:\n`;
    attribution += sources.map((source, index) => `${kind === "cited" ? `[${index + 1}] ` : "- "}${source.title ?? "Source"} — ${source.url}`).join("\n");
  }
  return displayed + attribution;
}
