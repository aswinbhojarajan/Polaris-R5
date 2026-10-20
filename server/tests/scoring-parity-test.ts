/**
 * Scoring Parity Test Script
 * 
 * Compares LLM-based scoring vs Heuristic-based scoring on the same AI responses.
 * Purpose: Measure drift between main path (LLM) and fallback path (heuristic)
 * 
 * Usage: npx tsx server/tests/scoring-parity-test.ts
 */

import { detectMentions, detectMentionsAsync, generateSpacingVariations } from '../services/mention-detector';
import { calculateVisibilityScore, calculateVisibilityScoreAsync } from '../services/visibility-scoring';
import { calculateSentimentScore, calculateSentimentScoreAsync } from '../services/scoring';

interface TestCase {
  name: string;
  rawResponse: string;
  brandName: string;
  aliases: string[];
}

interface ScoringResult {
  path: 'LLM' | 'Heuristic';
  mentionCount: number;
  visibilityScore: number;
  sentimentScore: number;
  firstMentionPos: number | null;
}

interface ParityResult {
  testCase: string;
  llmResult: ScoringResult;
  heuristicResult: ScoringResult;
  drift: {
    mentionCountDiff: number;
    visibilityDrift: number;
    visibilityDriftPercent: number;
    sentimentDrift: number;
    sentimentDriftPercent: number;
  };
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// Sample test cases from actual AI responses
const testCases: TestCase[] = [
  {
    name: "GPT-5.2 Fashion Response",
    rawResponse: `## Best fashion + beauty products to buy online in India
    
Best platforms for fashion:
- **Myntra** (best selection + easy returns): https://www.myntra.com/
- **Ajio** (strong on trend + frequent promos): https://www.ajio.com/
- **Tata CLiQ** (good for premium brands)

For jeans & chinos, best platforms: Myntra, Ajio, Amazon (brand stores).

For ethnic wear, try Myntra (huge catalog), Ajio (Indie/ethnic fusion).

For sneakers, check out Myntra (good pricing), Ajio (Puma/Adidas deals).

**Ajio** – great discounts, trend-forward catalog, strong private labels
https://www.ajio.com/`,
    brandName: "AJIO",
    aliases: ["Ajio", "AJIO Luxe", "Ajio Luxe"]
  },
  {
    name: "Gemini Fashion Response",
    rawResponse: `India's online fashion and beauty market is booming.

Ajio is a popular platform known for its wide variety of fashion brands and frequent discounts.
AJIO Luxe offers premium and luxury fashion products.

For everyday shopping, platforms like Myntra, Amazon Fashion, and Ajio offer great options.

The Ajio app provides personalized recommendations based on your style preferences.`,
    brandName: "AJIO",
    aliases: ["Ajio", "AJIO Luxe", "Ajio Luxe"]
  },
  {
    name: "Response with No Mentions",
    rawResponse: `Here are the best fashion platforms in India:
- Myntra
- Amazon Fashion
- Flipkart

These platforms offer great discounts and wide selection.`,
    brandName: "AJIO",
    aliases: ["Ajio", "AJIO Luxe", "Ajio Luxe"]
  },
  {
    name: "Response with Partial Match Risk",
    rawResponse: `For luxury fashion, check out:
- Nykaa Luxe for beauty
- Myntra Luxe collection
- Other Luxe brands

The fashion industry offers many luxe options.`,
    brandName: "AJIO",
    aliases: ["Luxe", "AJIO Luxe"]  // "Luxe" as alias - potential false positive
  }
];

async function runHeuristicPath(testCase: TestCase): Promise<ScoringResult> {
  const mentions = detectMentions(testCase.rawResponse, testCase.brandName, testCase.aliases);
  
  const visibilityResult = calculateVisibilityScore({
    brandName: testCase.brandName,
    aliases: testCase.aliases,
    rawResponse: testCase.rawResponse,
    selfCitationCount: 0
  });
  
  const sentimentResult = calculateSentimentScore(mentions);
  
  return {
    path: 'Heuristic',
    mentionCount: mentions.length,
    visibilityScore: visibilityResult.score,
    sentimentScore: sentimentResult.sentimentScore,
    firstMentionPos: visibilityResult.firstMentionPos
  };
}

async function runLLMPath(testCase: TestCase): Promise<ScoringResult> {
  try {
    const mentionResult = await detectMentionsAsync(testCase.rawResponse, testCase.brandName, testCase.aliases);
    
    const visibilityResult = await calculateVisibilityScoreAsync({
      brandName: testCase.brandName,
      aliases: testCase.aliases,
      rawResponse: testCase.rawResponse,
      entityMentions: mentionResult.entityMentions,
      selfCitationCount: 0
    });
    
    const sentimentResult = await calculateSentimentScoreAsync(
      mentionResult.mentions,
      { text: testCase.rawResponse },
      mentionResult.entityMentions,
      testCase.brandName,
      testCase.aliases
    );
    
    return {
      path: 'LLM',
      mentionCount: mentionResult.mentions.length,
      visibilityScore: visibilityResult.score,
      sentimentScore: sentimentResult.sentimentScore,
      firstMentionPos: visibilityResult.firstMentionPos
    };
  } catch (error) {
    console.error(`LLM path failed for ${testCase.name}:`, error);
    throw error;
  }
}

function calculateDrift(llm: ScoringResult, heuristic: ScoringResult): ParityResult['drift'] {
  const visibilityDrift = Math.abs(llm.visibilityScore - heuristic.visibilityScore);
  const sentimentDrift = Math.abs(llm.sentimentScore - heuristic.sentimentScore);
  
  const visibilityDriftPercent = heuristic.visibilityScore > 0 
    ? (visibilityDrift / heuristic.visibilityScore) * 100 
    : (llm.visibilityScore > 0 ? 100 : 0);
    
  const sentimentDriftPercent = heuristic.sentimentScore > 0 
    ? (sentimentDrift / heuristic.sentimentScore) * 100 
    : (llm.sentimentScore > 0 ? 100 : 0);
  
  return {
    mentionCountDiff: llm.mentionCount - heuristic.mentionCount,
    visibilityDrift,
    visibilityDriftPercent,
    sentimentDrift,
    sentimentDriftPercent
  };
}

function classifySeverity(drift: ParityResult['drift']): ParityResult['severity'] {
  if (drift.visibilityDriftPercent > 50 || drift.sentimentDriftPercent > 50) {
    return 'CRITICAL';
  }
  if (drift.visibilityDriftPercent > 25 || drift.sentimentDriftPercent > 25) {
    return 'HIGH';
  }
  if (drift.visibilityDriftPercent > 10 || drift.sentimentDriftPercent > 10) {
    return 'MEDIUM';
  }
  return 'LOW';
}

async function runParityTest(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║           SCORING PARITY TEST: LLM vs HEURISTIC                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
  
  const results: ParityResult[] = [];
  
  for (const testCase of testCases) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`TEST: ${testCase.name}`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`Brand: ${testCase.brandName}`);
    console.log(`Aliases: ${testCase.aliases.join(', ')}`);
    console.log(`Response length: ${testCase.rawResponse.length} chars\n`);
    
    try {
      // Run both paths
      const [llmResult, heuristicResult] = await Promise.all([
        runLLMPath(testCase),
        runHeuristicPath(testCase)
      ]);
      
      const drift = calculateDrift(llmResult, heuristicResult);
      const severity = classifySeverity(drift);
      
      results.push({
        testCase: testCase.name,
        llmResult,
        heuristicResult,
        drift,
        severity
      });
      
      // Print results
      console.log('┌─────────────────┬──────────────────┬──────────────────┐');
      console.log('│ Metric          │ LLM Path         │ Heuristic Path   │');
      console.log('├─────────────────┼──────────────────┼──────────────────┤');
      console.log(`│ Mentions        │ ${String(llmResult.mentionCount).padEnd(16)} │ ${String(heuristicResult.mentionCount).padEnd(16)} │`);
      console.log(`│ Visibility      │ ${llmResult.visibilityScore.toFixed(2).padEnd(16)} │ ${heuristicResult.visibilityScore.toFixed(2).padEnd(16)} │`);
      console.log(`│ Sentiment       │ ${llmResult.sentimentScore.toFixed(2).padEnd(16)} │ ${heuristicResult.sentimentScore.toFixed(2).padEnd(16)} │`);
      console.log(`│ First Position  │ ${String(llmResult.firstMentionPos ?? 'N/A').padEnd(16)} │ ${String(heuristicResult.firstMentionPos ?? 'N/A').padEnd(16)} │`);
      console.log('└─────────────────┴──────────────────┴──────────────────┘\n');
      
      console.log(`DRIFT ANALYSIS:`);
      console.log(`  Mention Count Diff: ${drift.mentionCountDiff > 0 ? '+' : ''}${drift.mentionCountDiff}`);
      console.log(`  Visibility Drift:   ${drift.visibilityDrift.toFixed(2)} points (${drift.visibilityDriftPercent.toFixed(1)}%)`);
      console.log(`  Sentiment Drift:    ${drift.sentimentDrift.toFixed(2)} points (${drift.sentimentDriftPercent.toFixed(1)}%)`);
      console.log(`  Severity:           ${severity}`);
      
    } catch (error) {
      console.error(`  ERROR: ${error}`);
    }
  }
  
  // Summary
  console.log('\n\n');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
  
  const severityCounts = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  let totalVisibilityDrift = 0;
  let totalSentimentDrift = 0;
  
  for (const result of results) {
    severityCounts[result.severity]++;
    totalVisibilityDrift += result.drift.visibilityDrift;
    totalSentimentDrift += result.drift.sentimentDrift;
  }
  
  console.log('Severity Distribution:');
  console.log(`  CRITICAL: ${severityCounts.CRITICAL}`);
  console.log(`  HIGH:     ${severityCounts.HIGH}`);
  console.log(`  MEDIUM:   ${severityCounts.MEDIUM}`);
  console.log(`  LOW:      ${severityCounts.LOW}`);
  console.log('');
  console.log(`Average Visibility Drift: ${(totalVisibilityDrift / results.length).toFixed(2)} points`);
  console.log(`Average Sentiment Drift:  ${(totalSentimentDrift / results.length).toFixed(2)} points`);
  
  if (severityCounts.CRITICAL > 0 || severityCounts.HIGH > 0) {
    console.log('\n⚠️  WARNING: High/Critical drift detected!');
    console.log('   Fallback to heuristic may produce significantly different scores.');
  }
}

// Run the test
runParityTest().catch(console.error);
