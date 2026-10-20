/**
 * ZIP Export Service
 * Bundles JSON snapshot + all CSV files into a single ZIP download
 */

import archiver from 'archiver';
import type { Response } from 'express';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { SnapshotData } from './report-snapshot';
import {
  generateCSVExports,
  streamResponsesCsvToFile,
  streamCitationsCsvToFile,
  streamMentionsCsvToFile,
  type ClientInfo,
  type CompetitorInfo,
  type NarrativeSectionInfo,
} from './csv-exporter';
import { generateEnhancedJSON } from './json-exporter';

// Task #105 (P3) — large CSVs are streamed to disk, not held in RAM.
const STREAMED_CSV_FILENAMES = new Set([
  'responses.csv',
  'citations.csv',
  'mentions.csv',
]);

export type NarrativeSection = NarrativeSectionInfo;

/**
 * Stream a ZIP file containing complete report export
 * Includes:
 * - snapshot.json (complete JSON data)
 * - metadata.csv
 * - client.csv
 * - competitors.csv
 * - prompts.csv
 * - models.csv
 * - responses.csv (with full answer text)
 * - citations.csv
 * - mentions.csv
 * - rankings.csv
 * - recommendations.csv
 * - competitor_scores.csv
 */
export async function streamZipExport(
  snapshot: SnapshotData,
  client: ClientInfo,
  competitors: CompetitorInfo[],
  narrativeSections: NarrativeSection[],
  res: Response
): Promise<void> {
  // Set headers for ZIP download
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `polaris-export-${client.name.replace(/\s+/g, '-')}-${timestamp}.zip`;
  
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  
  // Create archiver instance
  const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
  });
  
  // Handle errors
  archive.on('error', (err) => {
    console.error('ZIP generation error:', err);
    throw err;
  });
  
  // Pipe archive to response
  archive.pipe(res);
  
  // 1. Add complete JSON snapshot (raw data)
  archive.append(JSON.stringify(snapshot, null, 2), { 
    name: 'snapshot.json' 
  });
  
  // 2. Add enhanced JSON export (per-prompt analysis structure)
  const enhancedJSON = generateEnhancedJSON(snapshot, client, competitors);
  archive.append(JSON.stringify(enhancedJSON, null, 2), { 
    name: 'enhanced_export.json' 
  });
  
  // 3. Add narratives.json (generated consulting narratives)
  if (narrativeSections.length > 0) {
    const narrativesJSON = {
      reportId: snapshot.metadata.runIds[0] || '',
      clientName: client.name,
      generatedAt: narrativeSections[0]?.createdAt || snapshot.metadata.generatedAt,
      sections: Object.fromEntries(
        narrativeSections.map(s => [s.sectionName, s.sectionContent])
      ),
      metadata: {
        totalSections: narrativeSections.length,
        sectionOrder: narrativeSections.map(s => s.sectionName),
      }
    };
    archive.append(JSON.stringify(narrativesJSON, null, 2), { 
      name: 'narratives.json' 
    });
  }
  
  // 4. Generate and add all CSV files.
  //
  // Task #105 (P3) — Stream the three largest CSVs (responses,
  // citations, mentions) to a temp dir and archive them via
  // `archive.file(...)` so we never materialize the full string in
  // RAM. The remaining smaller CSVs stay on the in-memory path
  // (tiny row counts, simpler code).
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'polaris-export-'));
  try {
    const responsesPath = path.join(tmpDir, 'responses.csv');
    const citationsPath = path.join(tmpDir, 'citations.csv');
    const mentionsPath = path.join(tmpDir, 'mentions.csv');

    await Promise.all([
      streamResponsesCsvToFile(snapshot, responsesPath),
      streamCitationsCsvToFile(snapshot, citationsPath),
      streamMentionsCsvToFile(snapshot, mentionsPath),
    ]);

    archive.file(responsesPath, { name: 'responses.csv' });
    archive.file(citationsPath, { name: 'citations.csv' });
    archive.file(mentionsPath, { name: 'mentions.csv' });

    // Task #105 (P3) — Pass excludeFilenames so generateCSVExports
    // never builds the three large CSV strings in the first place
    // (the streamed-to-disk versions added above are the source of
    // truth for those files).
    const csvFiles = generateCSVExports(
      snapshot,
      client,
      competitors,
      narrativeSections,
      { excludeFilenames: STREAMED_CSV_FILENAMES },
    );
    for (const [filename, csvContent] of Object.entries(csvFiles)) {
      archive.append(csvContent, { name: filename });
    }
  
  // 5. Add README explaining the export
  const readme = `Polaris AI Platform - Complete Data Export
==========================================

Generated: ${snapshot.metadata.generatedAt}
Client: ${client.name}
Run IDs: ${snapshot.metadata.runIds.join(', ')}

Files Included:
--------------

=== JSON EXPORTS ===

snapshot.json
  Complete JSON snapshot with all diagnostic data (raw format)

enhanced_export.json
  PER-PROMPT analysis export with dual competitor structure:
  - competitorScores: Configured competitors with full scores
  - aiRankings: All entities (configured + discovered) with position data only

narratives.json
  Generated consulting narratives (12 sections):
  - executiveSummary, diagnosticOverview, competitiveLandscape
  - visibilityPerformance, criticalGaps, patternAnalysis
  - consultingInference, strategicImplications, leadershipConversations
  - businessImpact, actionPlan306090, implementationRoadmap

=== CSV EXPORTS ===

metadata.csv
  Overview metrics and run information

client.csv
  Client brand information (name, industry, geography, URLs, topics, keywords)

competitors.csv
  Competitor details tracked for this client

prompts.csv
  All prompts tested with text, source, and category

models.csv
  AI models used in the analysis (COMPLETE)
  Includes: vendor, model identifier, display name, rate limits (TPM/RPM),
  pricing (cost per 1K tokens input/output), enabled status

responses.csv
  Complete prompt-model pairs with FULL untruncated answer text (COMPLETE)
  Links prompts to models with citation/mention/ranking counts
  Includes per-answer scoring: visibility_score, sentiment_score, 
  position_score, first_mention_pos

citations.csv
  All citations extracted from AI responses
  Includes URLs, domains, display text, positions, types

mentions.csv
  All brand mentions detected in responses
  Includes spans, sentiment, and alias flags

rankings.csv
  All ranking positions where brands appeared
  Includes items, positions, client brand flags, groups

recommendations.csv
  Strategic recommendations from all sources
  Includes titles, categories, severity, descriptions, sources

competitor_scores.csv
  Visibility, position, and sentiment scores for all competitors

topics.csv
  Client topics with keywords and sources

prompt_categories.csv
  Prompt category taxonomy

run_statistics.csv
  Per-run metrics: prompts, responses, status

visibility_by_model.csv
  Visibility scores broken down by AI model

visibility_by_category.csv
  Visibility scores broken down by prompt category

mention_rates.csv
  Client and competitor mention rate percentages

ranking_analysis.csv
  Ranking position analysis with distributions

citation_analysis.csv
  Top citation domains and counts

top_competitors.csv
  Competitor performance summary

prompt_competitor_scores.csv
  PER-PROMPT scores for configured competitors ONLY (client + pre-configured)
  Includes visibility, sentiment, and position scores per prompt/model

prompt_ai_rankings.csv  
  PER-PROMPT rankings for ALL entities (configured + AI-discovered)
  Shows what AI actually ranked - includes position data only (no scores for discovered competitors)

prompt_citations.csv
  PER-PROMPT citations organized by prompt/model
  Easy to see which citations came from which specific prompts

narrative_sections.csv
  Generated consulting narrative sections with content and word counts
  Same content as narratives.json in tabular format

Usage:
------
- Open CSV files in Excel, Google Sheets, or any spreadsheet tool
- Use snapshot.json for programmatic analysis or re-import
- Use narratives.json for accessing generated consulting content
- responses.csv contains the complete AI answer text for each prompt-model pair
- Cross-reference using IDs (e.g., answer_id in citations.csv matches responses.csv)

Data Completeness:
-----------------
This export includes EVERY piece of data from the complete diagnostic pipeline:
✓ Client metadata and configuration (name, industry, geography, URLs, topics, keywords)
✓ All prompts (complete text with categories)
✓ All AI models (vendor, model, display name, rate limits, pricing, enabled status)
✓ All responses (full untruncated answers with per-answer scoring)
✓ All citations (URLs, domains, positions)
✓ All mentions (spans, sentiment)
✓ All rankings (positions, groups)
✓ All recommendations
✓ Competitor scores (visibility, sentiment, position per prompt)
✓ Topics and prompt categories
✓ X-Ray site analysis data (sites, pages, analysis)
✓ Aggregated metrics (visibility by model/category, mentions, rankings, citations)
✓ Generated consulting narratives (12 sections)

For questions or support, contact your Polaris administrator.
`;
  
    archive.append(readme, { name: 'README.txt' });

    // Finalize the archive (drains all queued append/file inputs).
    await archive.finalize();
  } finally {
    // Best-effort temp cleanup — by the time finalize() returns, archiver
    // has finished reading the files. Failures here are non-fatal: the
    // OS will clean /tmp eventually and this is a per-export tmp dir.
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn(
        `[ZipExport] Failed to clean tmp dir ${tmpDir}:`,
        cleanupErr,
      );
    }
  }
}
