import type { SnapshotData } from "./report-snapshot";
import { formatNativeAnswerForDisplay } from "../../shared/native-search-display";
import { validateGeneration } from "../../shared/native-web-search";

const escapeHTML = (value: string) => value.replace(/&/g, "&amp;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface NativeReportLink { number: number; url: string }

export function nativeReportLinks(snapshot: SnapshotData): NativeReportLink[] {
  return snapshot.responses.flatMap(response => {
    if (!response.nativeSearchEvidence) return [];
    const checked = validateGeneration({
      answerText: response.answer, evidence: response.nativeSearchEvidence,
    }).evidence;
    if (checked.error) throw new Error("Failed native evidence cannot be rendered as a successful report.");
    return checked.sources.filter(source => source.kind === "cited")
      .map((source, index) => ({ number: index + 1, url: source.url }));
  });
}

/** Only trusted native markers become PDF anchors; arbitrary model HTML stays inert. */
export function linkNativeReportCitations(content: string, links: NativeReportLink[],
  format: (value: string) => string = value => value): string {
  const replacements: Array<{ token: string; anchor: string }> = [];
  for (let index = 0; index < links.length; index++) {
    const link = links[index];
    const url = new URL(link.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
        !Number.isInteger(link.number) || link.number < 1) throw new Error("Invalid native PDF citation.");
    const marker = escapeHTML(`[${link.number}](${link.url})`);
    // Protect URLs (including valid Markdown metacharacters) from the legacy
    // formatter, then restore safe anchors only after text formatting.
    const token = `POLARISNATIVECITATION${index}END`;
    content = content.split(marker).join(token);
    replacements.push({ token, anchor: `<a href="${escapeHTML(link.url)}">[${link.number}]</a>` });
  }
  let html = format(content);
  for (const { token, anchor } of replacements) html = html.split(token).join(anchor);
  return html;
}

/**
 * Deterministic display-only supplement; never sent to a scorer or narrative
 * model. Uses the retained snapshot, not the possibly deleted original run.
 * Call with the raw (undecorated) narrative checkpoint on every render.
 */
export function appendNativeReportEvidence(content: string, snapshot: SnapshotData): string {
  const native = snapshot.responses.filter(response => response.nativeSearchEvidence);
  if (!native.length) return content;
  const sections = native.map((response, index) => {
    // The legacy PDF Markdown formatter accepts HTML; provider text and source
    // titles must remain inert text, never active tags or remote resources.
    const attributed = escapeHTML(formatNativeAnswerForDisplay(response.answer, response.nativeSearchEvidence));
    return `### Native answer ${index + 1}\n\nAnswer ID: ${response.answerId}\n\n${attributed}`;
  });
  return `${content}\n\n## Native Web Search Evidence\n\n` +
    "These are saved provider answers, not independent factual verification. " +
    "Native search sources are separate from analytical citation counts.\n\n" +
    sections.join("\n\n");
}
