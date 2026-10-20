/**
 * Task #110 — Build a self-describing filename for an Executive Report PDF.
 *
 * Shape: Polaris_<Kind>_<Client>[_-_<Project>]_<YYYY-MM-DD>_<id8>.pdf
 *
 * Both the client and project name are slugged (lowercase ASCII, non-alnum
 * runs collapsed to `_`, trimmed, capped at SEGMENT_MAX). When the project
 * name starts with the client name, that prefix is stripped from the
 * project segment. When the two are identical, the project segment is
 * dropped entirely. Total length is capped at FILENAME_MAX as a defensive
 * guard against pathological inputs (well under the 255-byte filesystem
 * limit on every common OS).
 */

const SEGMENT_MAX = 40;
const FILENAME_MAX = 150;

export type ReportFileKind = "insights" | "appendix";

export interface BuildReportFileNameInput {
  kind: ReportFileKind;
  clientName: string | null | undefined;
  projectName: string | null | undefined;
  generatedAt: Date | string | null | undefined;
  snapshotId: string;
}

function slugSegment(input: string | null | undefined, fallback: string): string {
  const raw = (input ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const ascii = raw.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!ascii) return fallback;
  const capped = ascii.slice(0, SEGMENT_MAX).replace(/^_+|_+$/g, "");
  return capped || fallback;
}

function formatDateUTC(input: Date | string | null | undefined): string {
  let d: Date;
  if (input instanceof Date) {
    d = input;
  } else if (typeof input === "string" && input) {
    d = new Date(input);
  } else {
    d = new Date();
  }
  if (isNaN(d.getTime())) d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function id8(snapshotId: string): string {
  const stripped = (snapshotId || "").replace(/-/g, "");
  return (stripped.slice(0, 8) || "00000000").toLowerCase();
}

export function buildReportFileBaseName(input: BuildReportFileNameInput): string {
  const kindLabel = input.kind === "insights" ? "Polaris_Insights" : "Polaris_Technical_Appendix";

  const clientSlug = slugSegment(input.clientName, "client");

  // Distinguish "project name was missing/empty in input" (use the
  // `project` fallback so the filename is still self-describing) from
  // "dedupe collapsed the project segment to empty" (drop it).
  const hasProjectInput = !!(input.projectName && String(input.projectName).trim());
  const rawProjectSlug = hasProjectInput
    ? slugSegment(input.projectName, "project")
    : "project";

  let projectSegment = rawProjectSlug;
  if (rawProjectSlug && clientSlug) {
    const lowerProject = rawProjectSlug.toLowerCase();
    const lowerClient = clientSlug.toLowerCase();
    if (lowerProject === lowerClient) {
      projectSegment = "";
    } else if (lowerProject.startsWith(lowerClient + "_")) {
      projectSegment = rawProjectSlug.slice(clientSlug.length + 1);
    } else if (lowerProject.startsWith(lowerClient)) {
      const stripped = rawProjectSlug.slice(clientSlug.length).replace(/^_+/, "");
      projectSegment = stripped;
    }
  }

  const namePart = projectSegment
    ? `${clientSlug}_-_${projectSegment}`
    : clientSlug;

  const date = formatDateUTC(input.generatedAt);
  const idSlice = id8(input.snapshotId);

  let base = `${kindLabel}_${namePart}_${date}_${idSlice}`;
  if (base.length > FILENAME_MAX) {
    const overflow = base.length - FILENAME_MAX;
    const trimmedNamePart = namePart.slice(0, Math.max(1, namePart.length - overflow));
    base = `${kindLabel}_${trimmedNamePart}_${date}_${idSlice}`;
  }
  return base;
}

export function buildReportFileName(input: BuildReportFileNameInput): string {
  return `${buildReportFileBaseName(input)}.pdf`;
}

/**
 * Set Content-Disposition with both an ASCII fallback (`filename=`) and an
 * RFC-5987 UTF-8 form (`filename*=`) so non-ASCII inputs degrade
 * gracefully on older browsers. The base name is already ASCII-only by
 * construction (slugSegment), so both forms end up identical — but we
 * still emit `filename*` for spec-compliance.
 */
export function contentDispositionHeader(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
