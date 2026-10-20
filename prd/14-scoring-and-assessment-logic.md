# 14 — Scoring and Assessment Logic (in one place)

This is the consolidated, evidence-anchored description of how Polaris produces scores. For formal definitions and worked examples, see `15-` and `16-`.

## Three-axis scoring model

Polaris computes three primary scores per `prompt_run_item` (one prompt × one model run):

- **Visibility (0–100)** — how present and prominent the brand is in the model's response.
- **Sentiment (0–100)** — the brand's perceived tone (negative=0, neutral=50, positive=100).
- **Position (0–100)** — how high the brand ranks when the response is a list / ranking.

These compose into an **Overall** via `composer.composeOverall` using `AEO_CONFIG.composerWeights = { visibility: 0.5, sentiment: 0.3, position: 0.2 }` (`server/config/aeo.ts`).

```
Overall = (V × 0.5 + S × 0.3 + P × 0.2) / (0.5 + 0.3 + 0.2)
```

Heuristic mode bypasses the composer and applies the same weighted average directly (`scoring.ts: calculateOverallScore`).

## Mode selection

`AEO_MODE` (env): `heuristic | llm | hybrid`.
- `heuristic` (default if no API key) → regex / token-based extraction + heuristic scoring.
- `llm` / `hybrid` → uses LLM mention/sentiment/ranking extraction; falls back to heuristic on failure.
- Provider for the LLM stack: `LLM_PROVIDER` (`openai|anthropic`); model: `LLM_MODEL` (default `gpt-4o-mini`).
- Confidence thresholds: `mention 0.7`, `sentiment 0.6`, `ranking 0.5` (`AEO_CONFIG.thresholds`).

## Visibility scoring

Two implementations, selected by `VISIBILITY_SCORING_VERSION`:

### V1 — `server/services/visibilityScorer.new.ts: calculateVisibilityAdvanced`
Weights (sum = 2.4, intentionally over-1):
- `mentionRate` (0.9) — mentions per ~100 tokens.
- `firstPos` (0.6) — `1 - clamp(firstMentionStart / textLen, 0, 1)`.
- `headingHits` (0.4) — count of mentions inside markdown headings, lists, numbered lists, "Title:" patterns; capped at 5/5.
- `coverage` (0.5) — bins-with-mention / 10 (text split into 10 equal slices).

Formula:
```
rawScore = 0.9 × mentionRate + 0.6 × firstPos + 0.4 × min(1, headingHits/5) + 0.5 × coverage
score   = round(100 × visibilitySigmoid(rawScore))
```

`visibilitySigmoid(x) = max(0, 2 × (sigmoid(x) − 0.5))` — shifted so `sigmoid(0) → 0` (no mentions = exact 0, not 50).

### V2 — `server/services/visibility-scoring-v2.ts: calculateVisibilityAdvancedV2`
Same factors, **normalized weights** (sum = 1.0): `mentionRate 0.40`, `firstPos 0.30`, `headingBonus 0.15`, `coverage 0.15`. Validated at runtime via `validateWeights()`. Same shifted sigmoid.

### Routing
`server/services/visibility-scoring.ts: calculateVisibilityScoreWithMentionsVersioned` reads `VISIBILITY_SCORING_VERSION` and dispatches to V1 or V2.

### Heuristic-mode (when no entityMentions)
`server/services/visibility-scoring.ts: calculateVisibilityScore` uses simple direct-vs-alias counts, normalized by words/100, with weights `α=0.9`, `β=0.6`, `γ=0.5`, `δ=0.4` (self-citation), then the same shifted sigmoid.

### Self-citation bonus
- In heuristic mode: included in `rawScore` via `δ × min(selfCitationCount, 3) / 3`.
- In LLM mode: applied as a percentage boost on top of the V1/V2 sigmoid score (`bonusPercent = δ × ratio × 100 / 3` ≈ up to ~13% additive boost), capped at 100. See `visibility-scoring.ts: calculateVisibilityScoreAsync`.

## Sentiment scoring

Three paths (in `server/services/scoring.ts: calculateSentimentScoreAsync`):

1. **LLM ABSA** — when `entityMentions` present and `AEO_MODE=llm|hybrid`. Calls `analyzeSentimentABSA(doc, entityMentions)` → array of `EntitySentiment { pPos, pNeu, pNeg, confidence }`. Score via `composer.sentimentScoreFromABSA`:
   ```
   For each sentiment:
     base       = (pPos − pNeg + 1) × 50         // map [-1,+1] → [0,100]
     shrinkage  = 1 − (1 − confidence)           // = confidence
     shrunken   = 50 + (base − 50) × shrinkage   // pull toward 50 by (1 − confidence)
     accumulate weightedSum += shrunken × confidence
                totalWeight  += confidence
   score = totalWeight > 0 ? weightedSum / totalWeight : 50
   ```
2. **Direct LLM fallback** — `analyzeDirectSentiment(text, brandName, aliases)` runs when `entityMentions` empty but brand+text are known. Returns its own `score` + counts.
3. **Heuristic fallback** — `findMentionsWithSentiment` regex-matches brand/aliases in the text (after `normalizeBrandToken` Unicode normalization) and scans the surrounding 100-char window for positive/negative term lists; then `calculateSentimentScoreHeuristic`:
   ```
   raw       = (positive − negative) / total       ∈ [-1, +1]
   score     = round((raw + 1) × 50 × 100) / 100   ∈ [0, 100]
   ```

If no mentions at all → score = 0 (not 50). This is intentional — see `15-`.

## Position scoring

Three implementations:

### Heuristic — `scoring.ts: calculatePositionScoreHeuristic`
- Position 1 → 100, 2 → 95, 3 → 90, 4 → 85, 5 → 80, 6+ → `max(0, 80 × e^{−0.2 × (pos − 5)})`.
- Final = average of per-ranking scores.
- 0 if no rankings.

### nDCG — `composer.ts: positionScoreFromRankings`
- For each ranking at position `p`: `DCG = 1 / log2(1 + p)`.
- IDCG = sum of `1 / log2(1 + i)` for `i = 1..N` where `N = rankings.length`.
- `score = round(100 × DCG / IDCG)`. Clamped 0–100.
- Used when `AEO_MODE !== 'heuristic'` (`scoring.ts: calculatePositionScore`).

### V2 group-aware — `composer.ts: calculatePositionScoreV2`
- Operates on `GroupedRanking { position, rankingGroup?, groupRelevance? }`.
- For every group in the response:
  - Determine `relevance` from any ranking with `groupRelevance` set (default `'relevant'`).
  - If brand present in group: `nDCGScore = positionScoreFromRankings(brandInGroup)`.
  - Else if relevance `'relevant'`: penalize with `positionScoreFromRankings([{ position: groupSize + 1 }])`.
  - Else (no brand and not relevant): `nDCGScore = 0`.
- Group `contributes` if relevance is `'relevant'` OR (`'partial'` AND brand present).
- Final = average of contributing nDCG scores; 0 if none contribute.
- Selected via `POSITION_SCORING_VERSION='v2'` (currently set in `.replit [userenv.shared]`).

### Recalculation
`POST /api/v1/prompt-runs/:id/recalculate-position` re-runs position scoring for a finished run — used after toggling `POSITION_SCORING_VERSION` or refining group-relevance tags.

## Mention detection

- **Heuristic**: `server/services/mention-detector.ts`. Uses `normalizeBrandToken` to apply Unicode normalization (strip diacritics, normalize hyphens/quotes/full-width chars), then case-insensitive `\\b...\\b` regex per brand and alias. Returns `EntityMention { span, start, end, canonicalId, surfaceType, confidence }`.
- **LLM**: `server/services/mentionExtractor.llm.ts`. Same output type.

## Ranking extraction

- **Heuristic**: `server/services/ranking-parser.ts`. Detects numbered lists, "Top N" patterns.
- **LLM (group-aware)**: `server/services/rankingExtractor.llm.ts`. Tags each ranking with `rankingGroup` (e.g. "Premium Airlines", "Budget Airlines") and `groupRelevance` (`relevant | partial | irrelevant`).

## Citation extraction

- `server/services/citation-extractor.ts` matches markdown links, bare URLs, and "soft" references; sets `citation_type_enum` to `hard` (URL) or `soft` (text reference). Self-citation (`isSelfCitation`) determined by comparing extracted domain to `clients.website`.

## Score persistence

- Per-item scores → `answers.{visibilityScore, sentimentScore, positionScore}`.
- Per-item factors → `score_factors` (one row per category per item) via `score-explainability.ts`.
- Per-(run, prompt, competitor) scores → `competitor_scores`.
- Score interpretations and color bands → `score_interpretations`, `score_color_bands` (rendered in the dashboard via `GET /api/v1/score-colors`).
