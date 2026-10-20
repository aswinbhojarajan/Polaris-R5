# 15 — Score Definitions: Visibility, Sentiment, Position

Formal definitions of every score with input ranges, output ranges, edge cases, and version notes. This is the spec; `14-` is the prose; `16-` is the worked examples.

## Common notation

- `T` = response text (`answers.rawResponse`).
- `M = { m_i }` = mentions of the brand inside `T`. Each mention has `start` ∈ [0, |T|).
- `R = { r_j }` = rankings (item, position).
- All output scores are rounded; bounds are `[0, 100]`.

## Visibility (V)

### Inputs
- `T`, `M`, optional `selfCitationCount`, optional self-citation list.
- Tunables: weights `{w_mr, w_fp, w_hb, w_co}` (V1 over-weighted; V2 normalized).

### Sub-factors

| Factor | Definition | Range |
|--------|------------|-------|
| `mentionRate` | `|M| / max(1, ⌈words(T) × 1.3⌉) × 100` | ≥ 0; typically ≤ ~5 for short responses. |
| `firstPos` | `1 − min(1, m_min.start / |T|)` (0 if `M` empty) | [0, 1]. |
| `headingHits` | count of `m_i.start` inside any heading/list/numbered/Title-with-colon range | ≥ 0. |
| `headingScore` (V1 raw / V2 explicit) | `min(1, headingHits / 5)` | [0, 1]. |
| `coverage` | `|{ ⌊m_i.start / binSize⌋ }| / 10` where `binSize = ⌈|T| / 10⌉` | [0, 1]. |

### V1 formula (`visibilityScorer.new.ts`)

```
raw = 0.9·mentionRate + 0.6·firstPos + 0.4·min(1, headingHits/5) + 0.5·coverage
V   = round(100 × visibilitySigmoid(raw))
```

### V2 formula (`visibility-scoring-v2.ts`)

```
raw = 0.40·mentionRate + 0.30·firstPos + 0.15·min(1, headingHits/5) + 0.15·coverage
V   = round(100 × visibilitySigmoid(raw))
```

Weights validated at runtime to sum to 1.0.

### Heuristic-only (no entityMentions; pre-LLM mode)

`visibility-scoring.ts: calculateVisibilityScore` uses `directScore = directMentions / normalizer`, `aliasScore = aliasMentions / normalizer` where `normalizer = max(1, words(T)/100)`, top-bonus for first mention ≤ 300 chars, citation bonus.

```
raw = α·directScore + β·aliasScore + γ·topBonus + δ·citationBonus
    = 0.9·...   + 0.6·...     + 0.5·...   + 0.4·...
V   = round(100 × visibilitySigmoid(raw) × 100) / 100
```

### Sigmoid

```
sigmoid(x)            = 1 / (1 + e^{-x})
visibilitySigmoid(x)  = max(0, 2 × (sigmoid(x) − 0.5))
                       = max(0, tanh(x / 2))
```

So `V(0) = 0`, `V(∞) = 100`. Smooth, monotonic, anchored.

### Edge cases

- `T` empty → V = 0 with empty details.
- `|M| = 0` → V = 0 (sigmoid input = 0).
- `headingHits` only counts each mention once via `for (const range of headingRanges) { ... break; }`.

## Sentiment (S)

### Inputs
- A list of mentions with sentiment labels `positive | neutral | negative`, **or** a list of ABSA scores `{ pPos, pNeu, pNeg, confidence }`.

### Heuristic formula (`scoring.ts: calculateSentimentScoreHeuristic`)

```
raw = (positive − negative) / total          ∈ [−1, +1]
S   = round((raw + 1) × 50 × 100) / 100      ∈ [0, 100]
```

If `total = 0` → S = 0 (not 50).

### LLM ABSA formula (`composer.ts: sentimentScoreFromABSA`)

For each `EntitySentiment`:
```
base      = (pPos − pNeg + 1) × 50           ∈ [0, 100]
shrinkage = 1 − (1 − confidence) = confidence
shrunken  = 50 + (base − 50) × shrinkage     // shrink toward 50 when confidence < 1
weightedSum += shrunken × confidence
totalWeight += confidence
```
```
S = totalWeight > 0 ? round(100 × weightedSum / totalWeight) / 100 : 50
```

> Implementation note: when `sentiments.length === 0`, `sentimentScoreFromABSA` returns `0` (brand not mentioned), not 50.

### Output ranges

- 0 — brand not mentioned, or all mentions negative.
- ~50 — neutral or low-confidence.
- 100 — all confident positive.

## Position (P)

### Inputs
- `R = { (item, position) }`. Brand-only rankings for V1/nDCG, all rankings for V2.

### Heuristic formula (`scoring.ts: calculatePositionScoreHeuristic`)

For each `r ∈ R`:
- `pos = 1 → 100`
- `pos = 2 → 95`
- `pos = 3 → 90`
- `pos = 4 → 85`
- `pos = 5 → 80`
- `pos ≥ 6 → max(0, 80 × e^{−0.2 × (pos − 5)})`

```
P = average of the per-ranking scores
```

If `|R| = 0` → P = 0.

### nDCG formula (`composer.ts: positionScoreFromRankings`)

```
DCG  = Σ 1 / log2(1 + r_j.position)
IDCG = Σ_{i=1..N} 1 / log2(1 + i)        // perfect ranking = N items at positions 1..N
P    = round(100 × DCG / IDCG), clamped [0, 100]
```

> All rankings have `relevance = 1` in code; positions are the only signal.

### V2 group-aware formula (`composer.ts: calculatePositionScoreV2`)

1. For every distinct `rankingGroup` in `allRankings`:
   - Determine `relevance` from any tagged ranking in the group; default `'relevant'`.
   - Compute `groupSize` = number of rankings in that group.
   - If brand is present in the group: `nDCG_group = positionScoreFromRankings(brandInGroup)`.
   - Else if `relevance === 'relevant'`: penalty `nDCG_group = positionScoreFromRankings([{ position: groupSize + 1 }])`.
   - Else: `nDCG_group = 0`.
   - `contributes = (relevance === 'relevant') OR (relevance === 'partial' AND brandPresent)`.
2. `P = round(average of contributing nDCG_group)`; 0 if none contribute.

### Edge cases

- Brand totally absent → V2 returns `{ score: 0, groupBreakdown: [] }` (early return guard).
- A "relevant" group with no brand contributes a real penalty score (small but nonzero), preventing optimization that hides the brand from relevant lists.
- "Irrelevant" groups never contribute (good — avoids polluting position scores with off-topic lists).

## Overall (O)

```
O = (w_v · V + w_s · S + w_p · P) / (w_v + w_s + w_p)
```
Default weights: `w_v = 0.5`, `w_s = 0.3`, `w_p = 0.2` (`AEO_CONFIG.composerWeights`). Sum = 1.0; the divisor exists so non-default weights still produce a 0–100 score.

## Score interpretations and bands

`score_interpretations` rows store `(category, scoreMin, scoreMax, messageTemplate)` — used by the dashboard / tooltip layer. `score_color_bands` rows store `(category, bandName, colorHex, scoreMin, scoreMax)`. Both are seeded; the API returns them via `GET /api/v1/score-colors`.

## Why "no mention = 0" (not 50)

Both Visibility and Sentiment hard-zero when the brand is absent. This is by design: the system is meant to reward presence, not reward neutrality of absence. The `visibilitySigmoid` (centered to map 0 → 0) and the explicit `sentiments.length === 0 → 0` branch both encode this rule.

## What is **not** scored

- Citations are not directly scored (count is stored on `answers.citationCount`, but no separate "Citation Score").
- Tone other than pos/neu/neg is not modeled.
- Rankings beyond integer positions (e.g., percentile rankings) are not modeled.
