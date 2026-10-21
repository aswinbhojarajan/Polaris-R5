import { db } from '../db';
import { reportSnapshots, reportSections, reportJobs, reportFiles, InsertReportSnapshot, InsertReportSection, InsertReportJob, InsertReportFile, clients, answers } from '@shared/schema';
import { aggregateSnapshotData, SnapshotData, ReportAggregator } from './report-snapshot';
import { summarizeResponsesBatch, type PromptResponseSummary } from './response-summarizer';
import { generateNarratives, generateDiagnosticAppendix, type GeneratedNarratives, type GeneratedAppendix } from './narrative-generator';
import { appendNativeReportEvidence, nativeReportLinks } from './native-report-attribution';
import { renderReportToPDF, renderAppendixToPDF } from './pdf-renderer';
import { eq, and, desc, inArray } from 'drizzle-orm';
import path from 'path';
import fs from 'fs/promises';

/**
 * Post-process narrative content to ensure proper markdown formatting.
 * LLMs sometimes emit content without proper line breaks between list items,
 * and may not use **bold** for headings. This function normalizes everything.
 */
function normalizeMarkdownFormatting(content: string): string {
  if (!content) return content;
  
  let normalized = content;
  
  // STEP 1: Add bold to common heading patterns that LLM missed
  // Pattern: "Heading Name:" at start of line or after sentence ending
  // Examples: "Technical & Crawlability Issues:", "By Intent Level:", "What DHL Risks Losing:"
  
  // First, protect already-bold headings from double-processing
  const boldHeadingPlaceholders: string[] = [];
  normalized = normalized.replace(/\*\*([^*]+?):\*\*/g, (match) => {
    boldHeadingPlaceholders.push(match);
    return `__BOLD_HEADING_${boldHeadingPlaceholders.length - 1}__`;
  });
  
  // Add bold to unformatted heading patterns (Title Case words followed by colon)
  // Match: Start of line or after .\n, then capitalized phrase ending with :
  normalized = normalized.replace(/^([A-Z][A-Za-z&\-\/\s]+?):\s/gm, '**$1:** ');
  normalized = normalized.replace(/\.\s+([A-Z][A-Za-z&\-\/\s]{3,50}?):\s/g, '.\n\n**$1:** ');
  
  // Restore protected bold headings
  boldHeadingPlaceholders.forEach((placeholder, index) => {
    normalized = normalized.replace(`__BOLD_HEADING_${index}__`, placeholder);
  });
  
  // STEP 2: Ensure numbered list items have line breaks before them
  normalized = normalized.replace(/([.!?])\s*(\d+\.\s+\*?\*?[A-Z])/g, '$1\n\n$2');
  
  // STEP 3: Ensure lettered list items have line breaks (A., B., C., etc.)
  normalized = normalized.replace(/([.!?])\s*([A-Z]\.\s+[A-Z])/g, '$1\n\n$2');
  
  // STEP 4: Ensure bullet points have line breaks before them
  normalized = normalized.replace(/([.!?])\s*([-*•]\s+)/g, '$1\n\n$2');
  
  // STEP 5: Ensure phase/time markers have line breaks
  normalized = normalized.replace(/([.!?:])(\s*)(Phase\s+\d+)/gi, '$1\n\n$3');
  normalized = normalized.replace(/([.!?:])(\s*)(\d+-\d+\s+Days?)/gi, '$1\n\n$3');
  
  // STEP 6: Ensure bold section markers have line breaks before them
  normalized = normalized.replace(/([.!?])\s*(\*\*[A-Z])/g, '$1\n\n$2');
  
  // STEP 7: Ensure "By X:" patterns are bold and on new lines
  normalized = normalized.replace(/([.!?])\s*(By\s+[A-Za-z\s]+:)/g, '$1\n\n**$2**');
  
  // STEP 8: Clean up any excessive newlines (more than 2 in a row)
  normalized = normalized.replace(/\n{3,}/g, '\n\n');
  
  // STEP 9: Ensure content after bold heading is on same line (not orphaned)
  // Fix pattern where number is alone on a line: "1.\n\n**Heading**" -> "1. **Heading**"
  normalized = normalized.replace(/(\d+\.)\s*\n+\s*(\*\*)/g, '$1 $2');
  
  return normalized.trim();
}

export interface ReportJobProgress {
  snapshotId: string;
  jobId: string;
  status: string;
  progressPercent: number;
  progressMessage: string;
  currentStep: string;
}

export async function processReportGeneration(
  clientId: string,
  projectId: string,
  runIds: string[],
  generatedBy: string,
  openaiApiKey: string,
  onProgress?: (progress: ReportJobProgress) => void,
  // Task #56: optional user id for attribution on the active-operations
  // banner. Null/undefined when triggered by background recovery.
  startedByUserId?: string | null,
  // Task #105 (R2): when set, reuse the existing snapshot row instead
  // of inserting a new one — and skip Steps 4/5 if their checkpointed
  // outputs (`narratives`, `appendix_content`) are already on the row.
  // Used by manual retry paths for partially-completed snapshots.
  existingSnapshotId?: string,
): Promise<{ snapshotId: string; jobId: string }> {

  let snapshotId = existingSnapshotId ?? '';
  let jobId = '';

  // Task #105 (R2) — preload checkpointed narratives/appendix when
  // resuming. Either can be present independently; both null on a
  // fresh generation.
  let cachedNarratives: GeneratedNarratives | null = null;
  let cachedAppendixContent: GeneratedAppendix | null = null;
  let snapshotGeneratedAt: Date | string | null = null;

  const updateProgress = async (
    status: 'queued' | 'aggregating' | 'analyzing' | 'rendering' | 'completed' | 'failed',
    progressPercent: number,
    progressMessage: string,
    currentStep: string
  ) => {
    await db.update(reportJobs)
      .set({ status, progressPercent, progressMessage, currentStep })
      .where(eq(reportJobs.id, jobId));

    if (onProgress) {
      onProgress({ snapshotId, jobId, status, progressPercent, progressMessage, currentStep });
    }
  };

  try {
    const initialSnapshot: InsertReportSnapshot = {
      clientId,
      projectId,
      runIds: runIds as any,
      snapshotData: {} as any,
      generatedBy,
      status: 'generating',
      narrativeGenerated: false,
    };

    const initialJob: InsertReportJob = {
      snapshotId,
      status: 'queued',
      progressPercent: 0,
      progressMessage: 'Starting report generation',
      currentStep: 'initializing',
      modelUsed: null,
      tokensUsed: null,
      costUsd: null,
      errorMessage: null,
    };

    if (existingSnapshotId) {
      // Resume path — verify snapshot exists, hydrate checkpoint cache,
      // and create a fresh report_jobs row (the previous one is in a
      // terminal state).
      const [existing] = await db
        .select({
          id: reportSnapshots.id,
          generatedAt: reportSnapshots.generatedAt,
          narratives: reportSnapshots.narratives,
          appendixContent: reportSnapshots.appendixContent,
        })
        .from(reportSnapshots)
        .where(eq(reportSnapshots.id, existingSnapshotId))
        .limit(1);

      if (!existing) {
        throw new Error(`Cannot resume: report snapshot ${existingSnapshotId} not found`);
      }

      snapshotId = existing.id;
      snapshotGeneratedAt = existing.generatedAt ?? null;
      // The schema declares these as Record<string, unknown>|null. They
      // are written by this same processor as GeneratedNarratives /
      // GeneratedAppendix shapes, so the narrowing is safe.
      cachedNarratives = (existing.narratives as GeneratedNarratives | null) ?? null;
      cachedAppendixContent = (existing.appendixContent as GeneratedAppendix | null) ?? null;

      // Reset snapshot status back to generating for the retry; keep
      // any prior snapshotData as a starting point but we re-aggregate
      // below to pick up any new data.
      await db
        .update(reportSnapshots)
        .set({ status: 'generating' })
        .where(eq(reportSnapshots.id, snapshotId));

      // Task #105 (R2) — Idempotent resume.
      //
      // Steps 6-8 of the pipeline insert into report_sections and
      // report_files unconditionally. If a previous attempt got far
      // enough to write any of those rows before crashing, replaying
      // the pipeline on the same snapshotId would create duplicate
      // section rows (breaking the on-page report which keys by
      // section_name) and orphan PDF file references. Wipe both
      // tables for this snapshot up front so the resumed run is the
      // single source of truth.
      const [deletedSections, deletedFiles] = await Promise.all([
        db.delete(reportSections).where(eq(reportSections.snapshotId, snapshotId)),
        db.delete(reportFiles).where(eq(reportFiles.snapshotId, snapshotId)),
      ]);

      console.log(
        `[ReportJob] Resuming snapshot ${snapshotId} (cachedNarratives=${!!cachedNarratives}, cachedAppendix=${!!cachedAppendixContent}, clearedSections=${(deletedSections as { rowCount?: number }).rowCount ?? '?'}, clearedFiles=${(deletedFiles as { rowCount?: number }).rowCount ?? '?'})`,
      );
    } else {
      const [insertedSnapshot] = await db.insert(reportSnapshots).values(initialSnapshot).returning({ id: reportSnapshots.id, generatedAt: reportSnapshots.generatedAt });
      snapshotId = insertedSnapshot.id;
      snapshotGeneratedAt = insertedSnapshot.generatedAt ?? null;
    }

    const [insertedJob] = await db
      .insert(reportJobs)
      .values({ ...initialJob, snapshotId, startedByUserId: startedByUserId ?? null })
      .returning({ id: reportJobs.id });
    jobId = insertedJob.id;

    // Step 1 of 8: Data Loading (5%)
    await updateProgress('aggregating', 5, 'Step 1 of 8: Loading diagnostic data from prompt runs', 'data_loading');

    const snapshotData = await aggregateSnapshotData(clientId, runIds);

    await db.update(reportSnapshots)
      .set({ snapshotData: snapshotData as any })
      .where(eq(reportSnapshots.id, snapshotId));

    // Step 2 of 8: Preparing data (20%)
    await updateProgress('analyzing', 20, `Step 2 of 8: Preparing ${snapshotData.responses.length} responses from ${snapshotData.models.length} models`, 'data_preparation');

    // Step 3 of 8: Summarizing responses (35%)
    await updateProgress('analyzing', 35, 'Step 3 of 8: Summarizing AI responses', 'response_summarization');

    // Task #105 (R2) — Split valid responses into "already-summarized"
    // (cached on answers.summary from a prior run) and "needs new
    // summary". Cached entries skip the OpenAI call entirely. Carry
    // answerId alongside each item so we can write the freshly-generated
    // summaries back to `answers.summary` for the next retry.
    type SummarizableInput = {
      answerId: string;
      promptText: string;
      modelName: string;
      answer: string;
      citationCount: number;
      mentionCount: number;
      rankingCount: number;
      cachedSummary: string | null;
    };

    const validInputs: SummarizableInput[] = snapshotData.responses
      .map((r): SummarizableInput | null => {
        const prompt = snapshotData.prompts.find(p => p.id === r.promptId);
        const model = snapshotData.models.find(m => m.id === r.modelId);

        if (!prompt || !prompt.text) {
          console.warn(`Skipping response ${r.promptRunItemId}: prompt ${r.promptId} is missing or has no text`);
          return null;
        }
        if (!model) {
          console.warn(`Skipping response ${r.promptRunItemId}: model ${r.modelId} is missing`);
          return null;
        }

        return {
          answerId: r.answerId,
          promptText: prompt.text,
          modelName: model.displayName || model.vendor,
          answer: r.answer,
          citationCount: r.citationCount,
          mentionCount: r.mentionCount,
          rankingCount: r.rankingCount,
          cachedSummary: r.summary && r.summary.trim().length > 0 ? r.summary : null,
        };
      })
      .filter((r): r is SummarizableInput => r !== null);

    if (validInputs.length === 0) {
      throw new Error('No valid responses available for summarization after filtering');
    }

    const needsSummary = validInputs.filter((r) => !r.cachedSummary);
    const cachedCount = validInputs.length - needsSummary.length;
    console.log(
      `Job processor: ${validInputs.length} valid responses (${cachedCount} reused from answers.summary cache, ${needsSummary.length} to summarize)`,
    );

    let totalOriginalChars = 0;
    let totalSummaryChars = 0;

    // Build cached PromptResponseSummary entries up-front. keyPatterns
    // is empty for cache hits — the narrative generator uses it as a
    // supplementary signal and tolerates an empty list.
    const cachedSummaries: PromptResponseSummary[] = validInputs
      .filter((r) => r.cachedSummary)
      .map((r) => {
        totalOriginalChars += r.answer.length;
        totalSummaryChars += r.cachedSummary!.length;
        return {
          promptText: r.promptText,
          modelName: r.modelName,
          summary: r.cachedSummary!,
          keyPatterns: [],
          citationCount: r.citationCount,
          mentionCount: r.mentionCount,
          rankingCount: r.rankingCount,
          originalTokens: 0,
          summaryTokens: 0,
        };
      });

    let freshSummaries: PromptResponseSummary[] = [];
    if (needsSummary.length > 0) {
      const summaryResult = await summarizeResponsesBatch(
        needsSummary.map(({ answerId: _ignored, cachedSummary: _ignored2, ...rest }) => rest),
        openaiApiKey,
      );
      freshSummaries = summaryResult.summaries;
      totalOriginalChars += summaryResult.totalOriginalTokens;
      totalSummaryChars += summaryResult.totalSummaryTokens;

      // Best-effort: write freshly-generated summaries back to
      // answers.summary so the next retry skips them. Failures are
      // non-fatal; the summaries are already in memory.
      try {
        const updates = freshSummaries
          .map((s, idx) => {
            const ans = needsSummary[idx];
            if (!ans?.answerId || !s.summary) return null;
            return { answerId: ans.answerId, summary: s.summary };
          })
          .filter((u): u is { answerId: string; summary: string } => u !== null);

        if (updates.length > 0) {
          await Promise.all(
            updates.map((u) =>
              db
                .update(answers)
                .set({ summary: u.summary })
                .where(eq(answers.id, u.answerId)),
            ),
          );
          console.log(`[ReportJob] Cached ${updates.length} new answer summaries`);
        }
      } catch (cacheErr) {
        console.warn(
          `[ReportJob] Non-fatal: failed to cache answer summaries: ${cacheErr instanceof Error ? cacheErr.message : String(cacheErr)}`,
        );
      }
    }

    const allSummaries: PromptResponseSummary[] = [...cachedSummaries, ...freshSummaries];
    const compressionRatio =
      totalOriginalChars > 0 && totalSummaryChars > 0
        ? totalOriginalChars / totalSummaryChars
        : 1;
    const summaryResult = {
      summaries: allSummaries,
      totalOriginalTokens: totalOriginalChars,
      totalSummaryTokens: totalSummaryChars,
      compressionRatio,
    };

    console.log(
      `[ReportJob] Total summaries assembled: ${allSummaries.length} (${compressionRatio.toFixed(1)}x compression)`,
    );

    // Fetch client context for narrative generation
    const [clientData] = await db.select({
      name: clients.name,
      projectName: clients.projectName,
      industry: clients.industry,
      geography: clients.geography,
    }).from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    const clientContext = {
      name: clientData?.name || 'Unknown Client',
      projectName: clientData?.projectName || null,
      industry: clientData?.industry,
      geography: clientData?.geography,
    };

    // Step 4 of 8: Generate Insights Report narratives (55%)
    await updateProgress('analyzing', 55, 'Step 4 of 8: Generating Insights Report narratives', 'insights_generation');

    // Task #105 (R2) — reuse checkpointed narratives if a previous run
    // saved them. We hydrate the same shape generateNarratives returns.
    let narratives: GeneratedNarratives;
    if (cachedNarratives) {
      console.log(`[ReportJob] Reusing checkpointed narratives for snapshot ${snapshotId}`);
      narratives = cachedNarratives;
    } else {
      narratives = await generateNarratives(snapshotData, summaryResult.summaries, clientContext, openaiApiKey);

      // Persist as checkpoint so a subsequent retry skips Step 4.
      try {
        await db
          .update(reportSnapshots)
          .set({ narratives: narratives as unknown as Record<string, unknown> })
          .where(eq(reportSnapshots.id, snapshotId));
      } catch (cpErr) {
        console.warn(
          `[ReportJob] Non-fatal: failed to checkpoint narratives: ${cpErr instanceof Error ? cpErr.message : String(cpErr)}`,
        );
      }
    }

    // Step 5 of 8: Generate Technical Appendix narratives (65%)
    await updateProgress('analyzing', 65, 'Step 5 of 8: Generating Technical Appendix content', 'appendix_generation');

    // Task #90 — Treat appendix as an independent deliverable. If it fails,
    // log it, surface it on the report job, but still produce the Insights
    // Report. The whole job no longer goes red because of an appendix-only
    // failure.
    type AppendixOutcome =
      | { ok: true; result: GeneratedAppendix }
      | { ok: false; error: string };
    let appendixOutcome: AppendixOutcome;
    if (cachedAppendixContent) {
      console.log(`[ReportJob] Reusing checkpointed appendix for snapshot ${snapshotId}`);
      appendixOutcome = { ok: true, result: cachedAppendixContent };
    } else {
      try {
        const appendixResult = await generateDiagnosticAppendix(snapshotData, summaryResult.summaries, clientContext, openaiApiKey);
        appendixOutcome = { ok: true, result: appendixResult };
        // Persist checkpoint.
        try {
          await db
            .update(reportSnapshots)
            .set({ appendixContent: appendixResult as unknown as Record<string, unknown> })
            .where(eq(reportSnapshots.id, snapshotId));
        } catch (cpErr) {
          console.warn(
            `[ReportJob] Non-fatal: failed to checkpoint appendix: ${cpErr instanceof Error ? cpErr.message : String(cpErr)}`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown appendix generation error';
        console.error(`[ReportJob] Technical Appendix generation failed (Insights Report will still be produced): ${message}`);
        appendixOutcome = { ok: false, error: message };
      }
    }

    // Keep checkpoints raw; apply required attribution to both fresh and cached
    // appendices, before section storage and PDF rendering.
    if (appendixOutcome.ok) {
      appendixOutcome = { ok: true, result: {
        ...appendixOutcome.result,
        diagnosticAppendix: appendNativeReportEvidence(
          appendixOutcome.result.diagnosticAppendix, snapshotData),
      } };
    }

    // Step 6 of 8: Save report sections (75%)
    await updateProgress('rendering', 75, 'Step 6 of 8: Saving report sections', 'section_storage');

    // Apply markdown normalization to all narrative sections before storage
    // This ensures proper line breaks for lists, phases, and bullet points
    const sectionInserts: InsertReportSection[] = [
      { snapshotId, sectionName: 'executive_summary', sectionContent: normalizeMarkdownFormatting(narratives.executiveSummary), sectionOrder: 1 },
      { snapshotId, sectionName: 'diagnostic_overview', sectionContent: normalizeMarkdownFormatting(narratives.diagnosticOverview), sectionOrder: 2 },
      { snapshotId, sectionName: 'competitive_landscape', sectionContent: normalizeMarkdownFormatting(narratives.competitiveLandscape), sectionOrder: 3 },
      { snapshotId, sectionName: 'visibility_performance', sectionContent: normalizeMarkdownFormatting(narratives.visibilityPerformance), sectionOrder: 4 },
      { snapshotId, sectionName: 'critical_gaps', sectionContent: normalizeMarkdownFormatting(narratives.criticalGaps), sectionOrder: 5 },
      { snapshotId, sectionName: 'pattern_analysis', sectionContent: normalizeMarkdownFormatting(narratives.patternAnalysis), sectionOrder: 6 },
      { snapshotId, sectionName: 'consulting_inference', sectionContent: normalizeMarkdownFormatting(narratives.consultingInference), sectionOrder: 7 },
      { snapshotId, sectionName: 'strategic_implications', sectionContent: normalizeMarkdownFormatting(narratives.strategicImplications), sectionOrder: 8 },
      { snapshotId, sectionName: 'leadership_conversations', sectionContent: normalizeMarkdownFormatting(narratives.leadershipConversations), sectionOrder: 9 },
      { snapshotId, sectionName: 'business_impact', sectionContent: normalizeMarkdownFormatting(narratives.businessImpact), sectionOrder: 10 },
      { snapshotId, sectionName: 'action_plan_306090', sectionContent: normalizeMarkdownFormatting(narratives.actionPlan306090), sectionOrder: 11 },
      { snapshotId, sectionName: 'implementation_roadmap', sectionContent: normalizeMarkdownFormatting(narratives.implementationRoadmap), sectionOrder: 12 },
    ];

    if (appendixOutcome.ok) {
      sectionInserts.push({
        snapshotId,
        sectionName: 'diagnostic_appendix',
        sectionContent: normalizeMarkdownFormatting(appendixOutcome.result.diagnosticAppendix),
        sectionOrder: 13,
      });
    } else {
      // Persist a placeholder so the UI can render a clear "unavailable"
      // message in the Diagnostic Appendix tab instead of an empty pane.
      sectionInserts.push({
        snapshotId,
        sectionName: 'diagnostic_appendix',
        sectionContent:
          `## Technical Appendix unavailable\n\n` +
          `The technical appendix could not be generated for this report. ` +
          `The Insights Report above is complete and unaffected.\n\n` +
          `**Reason:** ${appendixOutcome.error}\n`,
        sectionOrder: 13,
      });
    }

    await db.insert(reportSections).values(sectionInserts);

    // Step 7 of 8: Generate both PDFs in parallel (85%)
    await updateProgress(
      'rendering',
      85,
      appendixOutcome.ok
        ? 'Step 7 of 8: Generating PDF documents'
        : 'Step 7 of 8: Generating Insights PDF (Technical Appendix skipped — see error)',
      'pdf_generation',
    );

    // Create output directory
    const pdfDir = path.join(process.cwd(), 'generated_reports');
    await fs.mkdir(pdfDir, { recursive: true });

    const timestamp = Date.now();
    // Task #110 — anchor the on-disk YYYY-MM-DD to the snapshot row's
    // generated_at so it can never disagree with the
    // Content-Disposition filename emitted by the download routes
    // (which read snapshot.generatedAt). Falls back to wall-clock
    // only if the snapshot row somehow has no timestamp.
    const generatedAtSource: Date | string =
      (snapshotGeneratedAt ?? new Date());
    const generatedDate =
      generatedAtSource instanceof Date
        ? generatedAtSource.toISOString()
        : new Date(generatedAtSource).toISOString();

    // Task #110 — descriptive on-disk filenames so server-side log readers
    // and admins see the same shape users get on download. The
    // `_${timestamp}` suffix is preserved so two concurrent renders of the
    // same snapshot can never clobber each other.
    const { buildReportFileBaseName } = await import('../utils/report-filename');
    const insightsBase = buildReportFileBaseName({
      kind: 'insights',
      clientName: clientContext.name,
      projectName: clientContext.projectName,
      generatedAt: generatedDate,
      snapshotId,
    });
    const appendixBase = buildReportFileBaseName({
      kind: 'appendix',
      clientName: clientContext.name,
      projectName: clientContext.projectName,
      generatedAt: generatedDate,
      snapshotId,
    });
    const insightsPdfFileName = `${insightsBase}_${timestamp}.pdf`;
    const insightsPdfPath = path.join(pdfDir, insightsPdfFileName);
    const appendixPdfFileName = `${appendixBase}_${timestamp}.pdf`;
    const appendixPdfPath = path.join(pdfDir, appendixPdfFileName);

    // Generate Insights PDF always; Appendix PDF only when content was generated.
    // Task #104 — wrap the Insights PDF render in .catch() (mirroring the
    // Appendix pattern below) so a Chromium / Playwright failure here
    // does NOT escape to the outer catch and nuke the whole report. The
    // 13 saved sections are already in `report_sections` and viewable in
    // the UI; we just downgrade the job to `completed_partial` and let
    // the user re-attempt the PDF later.
    let insightsPdfError: string | null = null;
    const insightsPdfPromise: Promise<{ fileSize: number } | null> = renderReportToPDF(
      {
        snapshot: snapshotData,
        narratives,
        clientName: clientContext.name,
        generatedDate,
      },
      insightsPdfPath,
    ).catch((err: unknown) => {
      const m = err instanceof Error ? err.message : String(err);
      console.error(`[ReportJob] Insights PDF render failed (sections still saved): ${m}`);
      insightsPdfError = m;
      return null;
    });

    // Task #104 — track appendix PDF render failure separately from
    // appendix LLM failure. The previous code mutated `appendixOutcome`
    // to `{ok:false}` here, which silently zeroed out the appendix LLM
    // token / cost accounting below even though the LLM call had
    // succeeded and we paid for it.
    let appendixPdfError: string | null = null;
    const appendixPdfPromise: Promise<{ fileSize: number } | null> = appendixOutcome.ok
      ? renderAppendixToPDF(
          {
            appendixContent: appendixOutcome.result.diagnosticAppendix,
            nativeSearchLinks: nativeReportLinks(snapshotData),
            clientName: clientContext.name,
            generatedDate,
            metadata: {
              totalPrompts: snapshotData.prompts.length,
              totalModels: snapshotData.models.length,
              totalResponses: snapshotData.responses.length,
              totalCitations: snapshotData.citations.length,
            },
          },
          appendixPdfPath,
        ).catch((err: unknown) => {
          // PDF render of the appendix can also fail (e.g. Chromium crash on
          // huge content). Keep the LLM-side outcome intact so token
          // accounting stays accurate; just record the render failure.
          const m = err instanceof Error ? err.message : String(err);
          console.error(`[ReportJob] Technical Appendix PDF render failed (Insights Report still ready): ${m}`);
          appendixPdfError = m;
          return null;
        })
      : Promise.resolve(null);

    const [insightsPdfResult, appendixPdfResult] = await Promise.all([
      insightsPdfPromise,
      appendixPdfPromise,
    ]);

    // Step 8 of 8: Store PDF metadata (95%)
    await updateProgress('rendering', 95, 'Step 8 of 8: Storing report files', 'file_storage');

    // Task #104 — only insert file rows for PDFs that actually rendered.
    // Either or both can be missing now (Insights or Appendix can fail
    // independently), and the Reports page reads `report_files` to decide
    // which download buttons to enable.
    const fileInserts: InsertReportFile[] = [];
    if (insightsPdfResult) {
      fileInserts.push({
        snapshotId,
        fileType: 'insights_pdf',
        fileUrl: insightsPdfPath,
        fileSize: insightsPdfResult.fileSize,
      });
    }
    if (appendixPdfResult) {
      fileInserts.push({
        snapshotId,
        fileType: 'appendix_pdf',
        fileUrl: appendixPdfPath,
        fileSize: appendixPdfResult.fileSize,
      });
    }

    if (fileInserts.length > 0) {
      await db.insert(reportFiles).values(fileInserts);
    }

    // Calculate combined token usage and cost (appendix tokens are 0 if it
    // failed; we'll still log the partial total).
    const appendixTokens = appendixOutcome.ok ? appendixOutcome.result.metadata.tokensUsed : 0;
    const appendixCost = appendixOutcome.ok ? appendixOutcome.result.metadata.costUsd : 0;
    const totalTokensUsed = narratives.metadata.tokensUsed + appendixTokens;
    const totalCostUsd = narratives.metadata.costUsd + appendixCost;

    // Task #104 — Snapshot stays "ready" whenever the 13 sections were
    // saved (Step 6 succeeded), even if both PDFs subsequently failed.
    // The on-page report view reads `report_sections` directly and is
    // fully usable without any PDF on disk. The job row carries the
    // per-asset failure narrative for the UI to render warnings against.
    await db
      .update(reportSnapshots)
      .set({ status: 'ready', narrativeGenerated: true })
      .where(eq(reportSnapshots.id, snapshotId));

    // Build the human-facing job status from the two independent
    // outcomes. Four cases:
    //   both PDFs ok                        → completed
    //   insights ok, appendix failed         → completed_partial (existing #90 case)
    //   insights failed, appendix ok         → completed_partial (Task #104)
    //   both failed                          → completed_partial with both errors
    // We never use `status='failed'` here because sections were saved
    // and the user can still view + export the report.
    const insightsOk = insightsPdfResult !== null;
    const appendixLlmOk = appendixOutcome.ok;
    const appendixOk = appendixLlmOk && appendixPdfResult !== null;

    const failureNotes: string[] = [];
    if (!insightsOk && insightsPdfError) {
      failureNotes.push(`Insights PDF unavailable: ${insightsPdfError}`);
    }
    if (!appendixLlmOk) {
      failureNotes.push(`Technical Appendix unavailable: ${appendixOutcome.error}`);
    } else if (appendixPdfError) {
      failureNotes.push(`Technical Appendix PDF render failed: ${appendixPdfError}`);
    }

    const allOk = insightsOk && appendixOk;
    const finalStatus: 'completed' = 'completed';
    const finalCurrentStep = allOk ? 'completed' : 'completed_partial';
    const finalProgressMessage = allOk
      ? 'Both reports generated successfully'
      : insightsOk
        ? 'Insights Report ready — Technical Appendix unavailable (see error)'
        : appendixOk
          ? 'Technical Appendix ready — Insights PDF unavailable (see error)'
          : 'Report sections saved — both PDFs unavailable (see error)';

    await db
      .update(reportJobs)
      .set({
        status: finalStatus,
        progressPercent: 100,
        progressMessage: finalProgressMessage,
        currentStep: finalCurrentStep,
        modelUsed: narratives.metadata.modelUsed,
        tokensUsed: totalTokensUsed,
        costUsd: totalCostUsd.toString(),
        errorMessage: failureNotes.length > 0 ? failureNotes.join(' | ') : null,
        completedAt: new Date(),
      })
      .where(eq(reportJobs.id, jobId));

    if (onProgress) {
      onProgress({
        snapshotId,
        jobId,
        status: finalStatus,
        progressPercent: 100,
        progressMessage: finalProgressMessage,
        currentStep: finalCurrentStep,
      });
    }

    if (allOk) {
      console.log(
        `[ReportJob] Completed: Insights PDF (${(insightsPdfResult!.fileSize / 1024).toFixed(1)}KB) + Appendix PDF (${appendixPdfResult ? (appendixPdfResult.fileSize / 1024).toFixed(1) : 'n/a'}KB)`,
      );
    } else {
      console.warn(`[ReportJob] Completed (partial): ${failureNotes.join(' | ')}`);
    }
    console.log(`[ReportJob] Total tokens: ${totalTokensUsed}, Cost: $${totalCostUsd.toFixed(4)}`);

    return { snapshotId, jobId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during report generation';

    // Task #104 — only mark the snapshot itself `failed` if the failure
    // happened BEFORE the 13 sections were persisted. If sections exist,
    // the report is viewable and downloadable as JSON/CSV; degrade to
    // `completed_partial` instead of nuking everything the user can see.
    let sectionsAlreadySaved = false;
    if (snapshotId) {
      try {
        const existing = await db
          .select({ id: reportSections.id })
          .from(reportSections)
          .where(eq(reportSections.snapshotId, snapshotId))
          .limit(1);
        sectionsAlreadySaved = existing.length > 0;
      } catch {
        // best-effort — fall through to the original failed-state behavior
      }
    }

    if (sectionsAlreadySaved) {
      console.warn(
        `[ReportJob] Post-section-save failure (downgrading to completed_partial): ${errorMessage}`,
      );
      await Promise.all([
        db.update(reportSnapshots)
          .set({ status: 'ready', narrativeGenerated: true })
          .where(eq(reportSnapshots.id, snapshotId)),
        db.update(reportJobs)
          .set({
            status: 'completed',
            progressPercent: 100,
            progressMessage: 'Report sections saved — finalization step failed (see error)',
            currentStep: 'completed_partial',
            errorMessage,
            completedAt: new Date(),
          })
          .where(eq(reportJobs.id, jobId)),
      ]);
      return { snapshotId, jobId };
    }

    await Promise.all([
      db.update(reportSnapshots)
        .set({ status: 'failed' })
        .where(eq(reportSnapshots.id, snapshotId)),

      db.update(reportJobs)
        .set({
          status: 'failed',
          errorMessage,
          progressMessage: `Failed: ${errorMessage}`,
          completedAt: new Date(),
        })
        .where(eq(reportJobs.id, jobId)),
    ]);

    throw error;
  }
}

// Task #90 — Retry the Technical Appendix for an existing report snapshot.
// Used by POST /api/v1/reports/:id/retry-appendix when a report finished
// with appendix-only failure (snapshot status='ready', job has
// errorMessage prefixed with "Technical Appendix unavailable:"). Reuses
// the stored snapshotData; recomputes summaries on the fly.
export async function regenerateAppendixForSnapshot(
  snapshotId: string,
  openaiApiKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [snapshot] = await db
    .select()
    .from(reportSnapshots)
    .where(eq(reportSnapshots.id, snapshotId))
    .limit(1);
  if (!snapshot) {
    return { ok: false, error: 'Snapshot not found' };
  }

  // Pick the LATEST job for the snapshot — there is no DB-level uniqueness
  // on (snapshot_id) for report_jobs, and a future re-enqueue could create
  // a second row. We always retry against the most recent one.
  const [job] = await db
    .select()
    .from(reportJobs)
    .where(eq(reportJobs.snapshotId, snapshotId))
    .orderBy(desc(reportJobs.createdAt))
    .limit(1);
  if (!job) {
    return { ok: false, error: 'Report job not found' };
  }

  const [clientData] = await db
    .select({
      name: clients.name,
      projectName: clients.projectName,
      industry: clients.industry,
      geography: clients.geography,
    })
    .from(clients)
    .where(eq(clients.id, snapshot.clientId))
    .limit(1);
  if (!clientData) {
    return { ok: false, error: 'Client not found' };
  }

  const snapshotData = snapshot.snapshotData as SnapshotData;
  if (!snapshotData || !snapshotData.responses) {
    return { ok: false, error: 'Snapshot missing aggregated data' };
  }

  const clientContext = {
    name: clientData.name || 'Unknown Client',
    projectName: clientData.projectName || null,
    industry: clientData.industry,
    geography: clientData.geography,
  };

  const responsesToSummarize = snapshotData.responses
    .map((r) => {
      const prompt = snapshotData.prompts.find((p) => p.id === r.promptId);
      const model = snapshotData.models.find((m) => m.id === r.modelId);
      if (!prompt || !prompt.text || !model) return null;
      return {
        promptText: prompt.text,
        modelName: model.displayName || model.vendor,
        answer: r.answer,
        citationCount: r.citationCount,
        mentionCount: r.mentionCount,
        rankingCount: r.rankingCount,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (responsesToSummarize.length === 0) {
    return { ok: false, error: 'No valid responses available to summarize' };
  }

  try {
    const summaryResult = await summarizeResponsesBatch(responsesToSummarize, openaiApiKey);
    const appendixResult = await generateDiagnosticAppendix(
      snapshotData,
      summaryResult.summaries,
      clientContext,
      openaiApiKey,
    );
    const attributedAppendix = appendNativeReportEvidence(
      appendixResult.diagnosticAppendix, snapshotData);

    const pdfDir = path.join(process.cwd(), 'generated_reports');
    await fs.mkdir(pdfDir, { recursive: true });
    const timestamp = Date.now();
    // Task #110 — descriptive on-disk filename (regenerate-appendix path).
    // Use the snapshot's stored generatedAt so the on-disk date matches the
    // download Content-Disposition filename (which also reads from the
    // snapshot row), rather than the regenerate-time wall clock.
    const { buildReportFileBaseName } = await import('../utils/report-filename');
    const appendixBase = buildReportFileBaseName({
      kind: 'appendix',
      clientName: clientContext.name,
      projectName: clientContext.projectName,
      generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
      snapshotId,
    });
    const appendixPdfPath = path.join(
      pdfDir,
      `${appendixBase}_${timestamp}.pdf`,
    );

    const appendixPdfResult = await renderAppendixToPDF(
      {
        appendixContent: attributedAppendix,
        nativeSearchLinks: nativeReportLinks(snapshotData),
        clientName: clientContext.name,
        generatedDate: new Date().toISOString(),
        metadata: {
          totalPrompts: snapshotData.prompts.length,
          totalModels: snapshotData.models.length,
          totalResponses: snapshotData.responses.length,
          totalCitations: snapshotData.citations.length,
        },
      },
      appendixPdfPath,
    );

    // Replace ONLY the diagnostic_appendix section (other 12 sections stay
    // intact). Replace any old appendix_pdf file row + delete the file.
    await db
      .delete(reportSections)
      .where(
        and(
          eq(reportSections.snapshotId, snapshotId),
          eq(reportSections.sectionName, 'diagnostic_appendix'),
        ),
      );
    await db.insert(reportSections).values({
      snapshotId,
      sectionName: 'diagnostic_appendix',
      sectionContent: normalizeMarkdownFormatting(attributedAppendix),
      sectionOrder: 13,
    });

    const oldAppendixFiles = await db
      .select()
      .from(reportFiles)
      .where(
        and(
          eq(reportFiles.snapshotId, snapshotId),
          eq(reportFiles.fileType, 'appendix_pdf'),
        ),
      );
    for (const f of oldAppendixFiles) {
      try {
        await fs.unlink(f.fileUrl);
      } catch {
        // already gone
      }
    }
    await db
      .delete(reportFiles)
      .where(
        and(
          eq(reportFiles.snapshotId, snapshotId),
          eq(reportFiles.fileType, 'appendix_pdf'),
        ),
      );
    await db.insert(reportFiles).values({
      snapshotId,
      fileType: 'appendix_pdf',
      fileUrl: appendixPdfPath,
      fileSize: appendixPdfResult.fileSize,
    });

    // Clear the appendix-failure marker on the job row.
    await db
      .update(reportJobs)
      .set({
        errorMessage: null,
        progressMessage: 'Both reports generated successfully (appendix retried)',
        currentStep: 'completed',
      })
      .where(eq(reportJobs.id, job.id));

    return { ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`[ReportJob] Retry-appendix failed for snapshot ${snapshotId}: ${m}`);
    // Refresh the job error message so the UI shows the most recent failure.
    try {
      await db
        .update(reportJobs)
        .set({ errorMessage: `Technical Appendix unavailable: ${m}` })
        .where(eq(reportJobs.id, job.id));
    } catch {
      // best-effort
    }
    return { ok: false, error: m };
  }
}
