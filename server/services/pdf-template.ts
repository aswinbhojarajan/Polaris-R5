import { SnapshotData } from './report-snapshot';
import { GeneratedNarratives } from './narrative-generator';

import { linkNativeReportCitations, type NativeReportLink } from './native-report-attribution';

export interface TemplateData {
  snapshot: SnapshotData;
  narratives: GeneratedNarratives;
  clientName: string;
  generatedDate: string;
}

export function generateReportHTML(data: TemplateData): string {
  const { snapshot, narratives, clientName, generatedDate } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Visibility Report - ${clientName}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    @page {
      size: Letter;
      margin: 0.75in 0.75in 1in 0.75in;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1a1a1a;
      background: white;
    }

    /* Cover Page */
    .cover-page {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      page-break-after: always;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 2in;
    }

    .cover-page h1 {
      font-size: 48pt;
      font-weight: 700;
      margin-bottom: 0.5in;
      letter-spacing: -0.02em;
    }

    .cover-page h2 {
      font-size: 24pt;
      font-weight: 400;
      margin-bottom: 1in;
      opacity: 0.95;
    }

    .cover-page .meta {
      font-size: 14pt;
      opacity: 0.9;
      margin-top: 0.5in;
    }

    .cover-page .logo {
      font-size: 16pt;
      font-weight: 600;
      margin-top: auto;
      opacity: 0.8;
    }

    /* Table of Contents */
    .toc-page {
      page-break-after: always;
      padding-top: 0.5in;
    }

    .toc-page h2 {
      font-size: 28pt;
      font-weight: 700;
      margin-bottom: 0.5in;
      color: #667eea;
      border-bottom: 3px solid #667eea;
      padding-bottom: 0.15in;
    }

    .toc-list {
      list-style: none;
      margin-top: 0.3in;
    }

    .toc-list li {
      font-size: 14pt;
      margin-bottom: 0.2in;
      padding: 0.1in 0;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
    }

    .toc-list li:last-child {
      border-bottom: none;
    }

    .toc-section-number {
      font-weight: 700;
      color: #667eea;
      margin-right: 0.15in;
    }

    .toc-section-title {
      flex: 1;
    }

    .toc-page-number {
      color: #6b7280;
      font-weight: 500;
    }

    /* Content Sections */
    .section {
      page-break-before: always;
      padding-top: 0.3in;
    }

    .section-header {
      margin-bottom: 0.3in;
      padding-bottom: 0.15in;
      border-bottom: 2px solid #667eea;
    }

    .section-number {
      font-size: 14pt;
      font-weight: 700;
      color: #667eea;
      display: block;
      margin-bottom: 0.05in;
    }

    .section-title {
      font-size: 24pt;
      font-weight: 700;
      color: #1a1a1a;
    }

    .section-content {
      margin-top: 0.25in;
      text-align: justify;
      white-space: pre-wrap;
    }

    .section-content h3 {
      font-size: 16pt;
      font-weight: 600;
      margin-top: 0.25in;
      margin-bottom: 0.1in;
      color: #374151;
    }

    .section-content h4 {
      font-size: 13pt;
      font-weight: 600;
      margin-top: 0.2in;
      margin-bottom: 0.08in;
      color: #4b5563;
    }

    .section-content p {
      margin-bottom: 0.12in;
      word-wrap: break-word;
      hyphens: auto;
      line-height: 1.6;
    }

    /* Ordered lists - numbered items */
    .section-content ol {
      margin-left: 0.25in;
      margin-bottom: 0.15in;
      margin-top: 0.08in;
      padding-left: 0;
      list-style-position: outside;
    }

    /* Unordered lists - bullet points */
    .section-content ul {
      margin-left: 0.35in;
      margin-bottom: 0.08in;
      margin-top: 0.04in;
      padding-left: 0;
      list-style-position: outside;
    }

    /* List items - primary level */
    .section-content > ol > li,
    .section-content ol > li {
      margin-bottom: 0.12in;
      padding-left: 0.08in;
      word-wrap: break-word;
      hyphens: auto;
      line-height: 1.65;
    }

    .section-content > ul > li,
    .section-content ul > li {
      margin-bottom: 0.06in;
      padding-left: 0.05in;
      word-wrap: break-word;
      hyphens: auto;
      line-height: 1.6;
    }

    /* Nested lists */
    .section-content li > ul,
    .section-content li > ol {
      margin-top: 0.04in;
      margin-left: 0.25in;
      margin-bottom: 0.04in;
    }

    .section-content li li {
      margin-bottom: 0.04in;
      line-height: 1.55;
    }

    /* Bold text (headings) within content */
    .section-content strong {
      font-weight: 700;
      color: #1a1a1a;
    }

    /* Bold headings at start of list items */
    .section-content li strong {
      font-weight: 700;
      color: #111827;
    }

    /* Data Summary Box */
    .data-summary {
      background: #f9fafb;
      border-left: 4px solid #667eea;
      padding: 0.2in;
      margin: 0.25in 0;
      border-radius: 4px;
    }

    .data-summary h3 {
      font-size: 14pt;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 0.1in;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.15in;
      margin-top: 0.1in;
    }

    .summary-item {
      display: flex;
      flex-direction: column;
    }

    .summary-label {
      font-size: 9pt;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    .summary-value {
      font-size: 16pt;
      font-weight: 700;
      color: #1a1a1a;
      margin-top: 0.03in;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 0.2in 0;
      page-break-inside: auto;
    }

    thead {
      display: table-header-group;
    }

    tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }

    th {
      background: #667eea;
      color: white;
      font-weight: 600;
      text-align: left;
      padding: 0.08in 0.1in;
      font-size: 10pt;
    }

    td {
      border-bottom: 1px solid #e5e7eb;
      padding: 0.08in 0.1in;
      font-size: 10pt;
    }

    /* Footer */
    .page-footer {
      position: fixed;
      bottom: 0.5in;
      left: 0.75in;
      right: 0.75in;
      display: flex;
      justify-content: space-between;
      font-size: 9pt;
      color: #6b7280;
      border-top: 1px solid #e5e7eb;
      padding-top: 0.1in;
    }

    /* Avoid orphans */
    .no-break {
      page-break-inside: avoid;
    }

    /* Highlight boxes */
    .highlight-box {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 0.15in;
      margin: 0.2in 0;
      border-radius: 4px;
    }

    .highlight-box p {
      margin: 0;
      color: #92400e;
    }
  </style>
</head>
<body>

  <!-- Cover Page -->
  <div class="cover-page">
    <h1>Polaris Report</h1>
    <h2>${clientName}</h2>
    <div class="meta">
      <p>Generated on ${new Date(generatedDate).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })}</p>
      <p style="margin-top: 0.2in;">Analysis Period: ${new Date(snapshot.metadata.dateRange.earliest).toLocaleDateString('en-US', { 
        month: 'short', 
        year: 'numeric' 
      })} - ${new Date(snapshot.metadata.dateRange.latest).toLocaleDateString('en-US', { 
        month: 'short', 
        year: 'numeric' 
      })}</p>
    </div>
    <div class="logo">
      Polaris AI Platform
    </div>
  </div>

  <!-- Table of Contents -->
  <div class="toc-page">
    <h2>Table of Contents</h2>
    
    <div class="data-summary">
      <h3>Report Overview</h3>
      <div class="summary-grid">
        <div class="summary-item">
          <span class="summary-label">Total Prompts</span>
          <span class="summary-value">${snapshot.metadata.totalPrompts}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">AI Models</span>
          <span class="summary-value">${snapshot.metadata.totalModels}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Responses Analyzed</span>
          <span class="summary-value">${snapshot.responses.length}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Total Citations</span>
          <span class="summary-value">${snapshot.citations.length}</span>
        </div>
      </div>
    </div>

    <ul class="toc-list">
      <li>
        <span class="toc-section-number">1</span>
        <span class="toc-section-title">Executive Summary</span>
        <span class="toc-page-number">3</span>
      </li>
      <li>
        <span class="toc-section-number">2</span>
        <span class="toc-section-title">Diagnostic Overview</span>
        <span class="toc-page-number">4</span>
      </li>
      <li>
        <span class="toc-section-number">3</span>
        <span class="toc-section-title">Competitive Landscape</span>
        <span class="toc-page-number">5</span>
      </li>
      <li>
        <span class="toc-section-number">4</span>
        <span class="toc-section-title">Visibility Performance</span>
        <span class="toc-page-number">6</span>
      </li>
      <li>
        <span class="toc-section-number">5</span>
        <span class="toc-section-title">Critical Gaps</span>
        <span class="toc-page-number">7</span>
      </li>
      <li>
        <span class="toc-section-number">6</span>
        <span class="toc-section-title">Pattern Analysis</span>
        <span class="toc-page-number">8</span>
      </li>
      <li>
        <span class="toc-section-number">7</span>
        <span class="toc-section-title">Consulting Inference</span>
        <span class="toc-page-number">9</span>
      </li>
      <li>
        <span class="toc-section-number">8</span>
        <span class="toc-section-title">Strategic Implications</span>
        <span class="toc-page-number">10</span>
      </li>
      <li>
        <span class="toc-section-number">9</span>
        <span class="toc-section-title">Leadership Conversations</span>
        <span class="toc-page-number">11</span>
      </li>
      <li>
        <span class="toc-section-number">10</span>
        <span class="toc-section-title">Business Impact</span>
        <span class="toc-page-number">12</span>
      </li>
      <li>
        <span class="toc-section-number">11</span>
        <span class="toc-section-title">30/60/90-Day Action Plan</span>
        <span class="toc-page-number">13</span>
      </li>
      <li>
        <span class="toc-section-number">12</span>
        <span class="toc-section-title">Implementation Roadmap</span>
        <span class="toc-page-number">14</span>
      </li>
    </ul>
  </div>

  <!-- Section 1: Executive Summary -->
  <div class="section">
    <div class="section-header">
      <span class="section-number">SECTION 1</span>
      <h2 class="section-title">Executive Summary</h2>
    </div>
    <div class="section-content">
      ${formatNarrativeContent(narratives.executiveSummary)}
    </div>
  </div>

  <!-- Section 2: Diagnostic Overview -->
  <div class="section">
    <div class="section-header">
      <span class="section-number">SECTION 2</span>
      <h2 class="section-title">Diagnostic Overview</h2>
    </div>
    <div class="section-content">
      ${formatNarrativeContent(narratives.diagnosticOverview)}
    </div>
  </div>

  <!-- Section 3: Competitive Landscape -->
  <div class="section">
    <div class="section-header">
      <span class="section-number">SECTION 3</span>
      <h2 class="section-title">Competitive Landscape</h2>
    </div>
    <div class="section-content">
      ${formatNarrativeContent(narratives.competitiveLandscape)}
    </div>
  </div>

  <!-- Section 4: Visibility Performance -->
  <div class="section">
    <div class="section-header">
      <span class="section-number">SECTION 4</span>
      <h2 class="section-title">Visibility Performance</h2>
    </div>
    <div class="section-content">
      ${formatNarrativeContent(narratives.visibilityPerformance)}
    </div>
  </div>

  <!-- Section 5: Critical Gaps -->
  <div class="section">
    <div class="section-header">
      <span class="section-number">SECTION 5</span>
      <h2 class="section-title">Critical Gaps</h2>
    </div>
    <div class="section-content">
      ${formatNarrativeContent(narratives.criticalGaps)}
    </div>
  </div>

  <!-- Section 6: Pattern Analysis -->
  <div class="section">
    <div class="section-header">
      <span class="section-number">SECTION 6</span>
      <h2 class="section-title">Pattern Analysis</h2>
    </div>
    <div class="section-content">
      ${formatNarrativeContent(narratives.patternAnalysis)}
    </div>
  </div>

  <!-- Section 7: Consulting Inference -->
  <div class="section">
    <div class="section-header">
      <span class="section-number">SECTION 7</span>
      <h2 class="section-title">Consulting Inference</h2>
    </div>
    <div class="section-content">
      ${formatNarrativeContent(narratives.consultingInference)}
    </div>
  </div>

  <!-- Section 8: Strategic Implications -->
  <div class="section">
    <div class="section-header">
      <span class="section-number">SECTION 8</span>
      <h2 class="section-title">Strategic Implications</h2>
    </div>
    <div class="section-content">
      ${formatNarrativeContent(narratives.strategicImplications)}
    </div>
  </div>

  <!-- Section 9: Leadership Conversations -->
  <div class="section">
    <div class="section-header">
      <span class="section-number">SECTION 9</span>
      <h2 class="section-title">Leadership Conversations</h2>
    </div>
    <div class="section-content">
      ${formatNarrativeContent(narratives.leadershipConversations)}
    </div>
  </div>

  <!-- Section 10: Business Impact -->
  <div class="section">
    <div class="section-header">
      <span class="section-number">SECTION 10</span>
      <h2 class="section-title">Business Impact</h2>
    </div>
    <div class="section-content">
      ${formatNarrativeContent(narratives.businessImpact)}
    </div>
  </div>

  <!-- Section 11: 30/60/90-Day Action Plan -->
  <div class="section">
    <div class="section-header">
      <span class="section-number">SECTION 11</span>
      <h2 class="section-title">30/60/90-Day Action Plan</h2>
    </div>
    <div class="section-content">
      ${formatNarrativeContent(narratives.actionPlan306090)}
    </div>
  </div>

  <!-- Section 12: Implementation Roadmap -->
  <div class="section">
    <div class="section-header">
      <span class="section-number">SECTION 12</span>
      <h2 class="section-title">Implementation Roadmap</h2>
    </div>
    <div class="section-content">
      ${formatNarrativeContent(narratives.implementationRoadmap)}
    </div>
  </div>

</body>
</html>
</html>
  `.trim();
}

/**
 * Converts markdown tables to HTML tables with consulting-grade formatting.
 * Handles GFM-style tables with header rows and alignment.
 */
function convertMarkdownTables(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    
    // Check if this line starts a table (starts and ends with |)
    if (line.startsWith('|') && line.endsWith('|')) {
      // Look ahead to see if next line is a separator row (|---|---|)
      const nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
      const isSeparatorRow = nextLine.match(/^\|[\s\-:|]+\|$/);
      
      if (isSeparatorRow) {
        // This is a proper markdown table - parse it
        const tableRows: string[][] = [];
        let hasHeader = true;
        
        // Parse header row
        const headerCells = line.split('|').filter(cell => cell.trim() !== '');
        tableRows.push(headerCells.map(cell => cell.trim()));
        
        // Skip separator row
        i += 2;
        
        // Parse body rows
        while (i < lines.length) {
          const bodyLine = lines[i].trim();
          if (bodyLine.startsWith('|') && bodyLine.endsWith('|')) {
            const bodyCells = bodyLine.split('|').filter(cell => cell.trim() !== '');
            tableRows.push(bodyCells.map(cell => cell.trim()));
            i++;
          } else {
            break;
          }
        }
        
        // Generate HTML table
        let tableHtml = '<table>\n';
        
        if (hasHeader && tableRows.length > 0) {
          tableHtml += '  <thead>\n    <tr>\n';
          tableRows[0].forEach(cell => {
            tableHtml += `      <th>${cell}</th>\n`;
          });
          tableHtml += '    </tr>\n  </thead>\n';
        }
        
        if (tableRows.length > 1) {
          tableHtml += '  <tbody>\n';
          for (let r = 1; r < tableRows.length; r++) {
            tableHtml += '    <tr>\n';
            tableRows[r].forEach(cell => {
              tableHtml += `      <td>${cell}</td>\n`;
            });
            tableHtml += '    </tr>\n';
          }
          tableHtml += '  </tbody>\n';
        }
        
        tableHtml += '</table>';
        result.push(tableHtml);
        continue;
      }
    }
    
    // Not a table line, keep as-is
    result.push(lines[i]);
    i++;
  }
  
  return result.join('\n');
}

function formatNarrativeContent(content: string): string {
  if (!content || content.trim().length === 0) {
    return '<p><em>No content available for this section.</em></p>';
  }

  let formatted = content;

  // STEP 1: Split run-together numbered items
  // Pattern 1: "...text. 2. **Next Item**" becomes "...text.\n\n2. **Next Item**"
  formatted = formatted.replace(/(\.)(\s+)(\d+\.\s+\*\*)/g, '$1\n\n$3');
  
  // Pattern 2: "...text 2. **Next Item**" (missing period before number)
  formatted = formatted.replace(/([a-z])\s+(\d+\.\s+\*\*)/g, '$1.\n\n$2');
  
  // Pattern 3: "...text. 2. Next item" (no bold wrapper - more resilient)
  formatted = formatted.replace(/([.!?])(\s+)(\d+\.\s+[A-Z])/g, '$1\n\n$3');
  
  // Pattern 4: Split items when sentence ends mid-line before numbered item
  formatted = formatted.replace(/([.!?])\s+(\d+\.\s+)/g, '$1\n\n$2');

  // STEP 2: Convert inline markdown styles
  formatted = formatted.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  formatted = formatted.replace(/\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // STEP 3: Convert markdown headings to HTML
  formatted = formatted.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  formatted = formatted.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  formatted = formatted.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  formatted = formatted.replace(/^# (.+)$/gm, '<h3>$1</h3>');

  // STEP 4: Convert markdown tables to HTML tables
  formatted = convertMarkdownTables(formatted);

  // STEP 5: Process line by line for proper HTML structure
  const lines = formatted.split('\n');
  const processedLines: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' | null = null;
  let currentParagraph: string[] = [];

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const paragraphText = currentParagraph.join(' ').trim();
      // Only emit paragraph if it has content
      // Allow inline HTML like <strong>, <em>, but skip block-level elements like <h3>, <h4>
      if (paragraphText.length > 0 && !paragraphText.match(/^<h[1-6][\s>]/)) {
        processedLines.push(`<p>${paragraphText}</p>`);
      }
      currentParagraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Empty lines close lists and flush paragraphs
    if (trimmedLine.length === 0) {
      flushParagraph();
      if (inList) {
        processedLines.push(`</${listType}>`);
        inList = false;
        listType = null;
      }
      continue;
    }

    // Headings close lists and paragraphs
    if (trimmedLine.startsWith('<h')) {
      flushParagraph();
      if (inList) {
        processedLines.push(`</${listType}>`);
        inList = false;
        listType = null;
      }
      processedLines.push(trimmedLine);
      continue;
    }

    // HTML tables - pass through as-is (already converted from markdown)
    if (trimmedLine.startsWith('<table') || trimmedLine.startsWith('</table') ||
        trimmedLine.startsWith('<thead') || trimmedLine.startsWith('</thead') ||
        trimmedLine.startsWith('<tbody') || trimmedLine.startsWith('</tbody') ||
        trimmedLine.startsWith('<tr') || trimmedLine.startsWith('</tr') ||
        trimmedLine.startsWith('<th') || trimmedLine.startsWith('<td')) {
      flushParagraph();
      if (inList) {
        processedLines.push(`</${listType}>`);
        inList = false;
        listType = null;
      }
      processedLines.push(trimmedLine);
      continue;
    }

    // Ordered list items (numbered)
    if (trimmedLine.match(/^\d+\.\s/)) {
      flushParagraph();
      if (!inList || listType !== 'ol') {
        if (inList) processedLines.push(`</${listType}>`);
        processedLines.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      const listContent = trimmedLine.replace(/^\d+\.\s+/, '').trim();
      processedLines.push(`<li>${listContent}</li>`);
      continue;
    }

    // Unordered list items (bullets)
    if (trimmedLine.match(/^[-*•]\s/)) {
      flushParagraph();
      if (!inList || listType !== 'ul') {
        if (inList) processedLines.push(`</${listType}>`);
        processedLines.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      const listContent = trimmedLine.replace(/^[-*•]\s+/, '').trim();
      processedLines.push(`<li>${listContent}</li>`);
      continue;
    }

    // Regular paragraph content
    if (inList) {
      processedLines.push(`</${listType}>`);
      inList = false;
      listType = null;
    }
    
    currentParagraph.push(trimmedLine);
    
    // Flush paragraph if next line signals a break
    if (i + 1 >= lines.length) {
      flushParagraph();
    } else {
      const nextLine = lines[i + 1].trim();
      if (nextLine.length === 0 || 
          nextLine.match(/^\d+\.\s/) || 
          nextLine.match(/^[-*•]\s/) || 
          nextLine.startsWith('<h')) {
        flushParagraph();
      }
    }
  }

  // Final cleanup
  flushParagraph();
  if (inList && listType) {
    processedLines.push(`</${listType}>`);
  }

  return processedLines.join('\n');
}

export interface AppendixTemplateData {
  appendixContent: string;
  nativeSearchLinks?: NativeReportLink[];
  clientName: string;
  generatedDate: string;
  metadata?: {
    totalPrompts?: number;
    totalModels?: number;
    totalResponses?: number;
    totalCitations?: number;
  };
}

export function generateAppendixHTML(data: AppendixTemplateData): string {
  const { appendixContent, clientName, generatedDate, metadata } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Technical Appendix - ${clientName}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    @page {
      size: Letter;
      margin: 0.75in 0.75in 1in 0.75in;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 10pt;
      line-height: 1.5;
      color: #1a1a1a;
      background: white;
    }

    /* Cover Page - Technical/Data-focused styling */
    .cover-page {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      page-break-after: always;
      background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
      color: white;
      padding: 2in;
    }

    .cover-page h1 {
      font-size: 42pt;
      font-weight: 700;
      margin-bottom: 0.3in;
      letter-spacing: -0.02em;
    }

    .cover-page h2 {
      font-size: 22pt;
      font-weight: 400;
      margin-bottom: 0.8in;
      opacity: 0.95;
    }

    .cover-page .subtitle {
      font-size: 14pt;
      opacity: 0.85;
      margin-bottom: 0.5in;
      font-style: italic;
    }

    .cover-page .meta {
      font-size: 13pt;
      opacity: 0.9;
      margin-top: 0.3in;
    }

    .cover-page .logo {
      font-size: 14pt;
      font-weight: 600;
      margin-top: auto;
      opacity: 0.8;
    }

    /* Content area */
    .appendix-content {
      padding-top: 0.3in;
    }

    .appendix-content h1 {
      font-size: 22pt;
      font-weight: 700;
      margin-top: 0.4in;
      margin-bottom: 0.2in;
      color: #1e3a5f;
      border-bottom: 2px solid #1e3a5f;
      padding-bottom: 0.1in;
      page-break-after: avoid;
    }

    .appendix-content h2 {
      font-size: 16pt;
      font-weight: 600;
      margin-top: 0.3in;
      margin-bottom: 0.15in;
      color: #2d5a87;
      page-break-after: avoid;
    }

    .appendix-content h3 {
      font-size: 13pt;
      font-weight: 600;
      margin-top: 0.2in;
      margin-bottom: 0.1in;
      color: #374151;
      page-break-after: avoid;
    }

    .appendix-content h4 {
      font-size: 11pt;
      font-weight: 600;
      margin-top: 0.15in;
      margin-bottom: 0.08in;
      color: #4b5563;
    }

    .appendix-content p {
      margin-bottom: 0.1in;
      text-align: justify;
      hyphens: auto;
    }

    .appendix-content ul, .appendix-content ol {
      margin-left: 0.3in;
      margin-bottom: 0.1in;
    }

    .appendix-content li {
      margin-bottom: 0.05in;
    }

    .appendix-content strong {
      font-weight: 700;
      color: #1a1a1a;
    }

    .appendix-content em {
      font-style: italic;
    }

    /* Tables - Technical/Data styling */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 0.15in 0;
      font-size: 9pt;
      page-break-inside: auto;
    }

    thead {
      display: table-header-group;
    }

    tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }

    th {
      background: #1e3a5f;
      color: white;
      font-weight: 600;
      text-align: left;
      padding: 0.06in 0.08in;
      font-size: 9pt;
      border: 1px solid #1e3a5f;
    }

    td {
      border: 1px solid #d1d5db;
      padding: 0.05in 0.08in;
      font-size: 9pt;
      vertical-align: top;
    }

    tr:nth-child(even) td {
      background: #f9fafb;
    }

    /* Code/technical blocks */
    code {
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 8pt;
      background: #f3f4f6;
      padding: 0.02in 0.04in;
      border-radius: 2px;
    }

    pre {
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 8pt;
      background: #f3f4f6;
      padding: 0.1in;
      border-radius: 4px;
      overflow-x: auto;
      margin: 0.1in 0;
    }

    /* Data summary box */
    .data-summary {
      background: #f0f4f8;
      border-left: 4px solid #1e3a5f;
      padding: 0.15in;
      margin: 0.2in 0;
      border-radius: 4px;
    }

    .data-summary h3 {
      font-size: 12pt;
      font-weight: 600;
      color: #1e3a5f;
      margin-bottom: 0.08in;
      margin-top: 0;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.1in;
    }

    .summary-item {
      display: flex;
      flex-direction: column;
    }

    .summary-label {
      font-size: 8pt;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 600;
    }

    .summary-value {
      font-size: 14pt;
      font-weight: 700;
      color: #1e3a5f;
    }

    /* Page footer */
    .page-footer {
      position: fixed;
      bottom: 0.5in;
      left: 0.75in;
      right: 0.75in;
      display: flex;
      justify-content: space-between;
      font-size: 8pt;
      color: #6b7280;
      border-top: 1px solid #e5e7eb;
      padding-top: 0.08in;
    }

    /* Avoid orphans */
    .no-break {
      page-break-inside: avoid;
    }
  </style>
</head>
<body>
  <!-- Cover Page -->
  <div class="cover-page">
    <h1>Technical Appendix</h1>
    <h2>${clientName}</h2>
    <p class="subtitle">Diagnostic Data & Detailed Metrics</p>
    <p class="meta">Generated: ${new Date(generatedDate).toLocaleDateString('en-US', { 
      weekday: 'long',
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    })}</p>
    <div class="logo">
      Polaris AI Platform
    </div>
  </div>

  ${metadata ? `
  <!-- Data Summary -->
  <div class="data-summary">
    <h3>Analysis Overview</h3>
    <div class="summary-grid">
      <div class="summary-item">
        <span class="summary-label">Total Prompts</span>
        <span class="summary-value">${metadata.totalPrompts || 0}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">AI Models</span>
        <span class="summary-value">${metadata.totalModels || 0}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Responses</span>
        <span class="summary-value">${metadata.totalResponses || 0}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Citations</span>
        <span class="summary-value">${metadata.totalCitations || 0}</span>
      </div>
    </div>
  </div>
  ` : ''}

  <!-- Appendix Content -->
  <div class="appendix-content">
    ${linkNativeReportCitations(appendixContent, data.nativeSearchLinks ?? [], formatNarrativeContent)}
  </div>

  <!-- Footer -->
  <div class="page-footer">
    <span>${clientName} - Technical Appendix</span>
    <span>Confidential - Polaris AI</span>
  </div>
</body>
</html>
  `.trim();
}
