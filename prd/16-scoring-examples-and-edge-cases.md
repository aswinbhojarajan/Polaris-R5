# 16 — Scoring Examples and Edge Cases

Worked examples are computed by hand against the formulas in `15-`. Numbers are rounded the same way the code does (typically `Math.round(score)` or `Math.round(score * 100) / 100`).

## Visibility V1 — short response, single mention near the top

**Setup**:
- `T` = "Among premium airlines, **Emirates** stands out for its in-flight service." (≈ 70 chars).
- 1 mention; `m.start ≈ 23`.
- Words ≈ 11; `roughTokenCount = ceil(11 × 1.3) = 15`.
- No headings; coverage bin = 1/10.

**Compute**:
- `mentionRate = 1 / 15 × 100 = 6.667`.
- `firstPos = 1 − 23 / 70 = 0.671`.
- `headingHits = 0 → headingScore = 0`.
- `coverage = 0.1`.
- `raw = 0.9 × 6.667 + 0.6 × 0.671 + 0.4 × 0 + 0.5 × 0.1 = 6.451`.
- `sigmoid(6.451) ≈ 0.99841`.
- `visibilitySigmoid = 2 × (0.99841 − 0.5) = 0.99681`.
- `V = round(100 × 0.99681) = 100`.

> The shifted sigmoid saturates fast at high `raw`. **Implication**: V1 hits 100 easily. V2 normalizes weights to soften this.

## Visibility V2 — same response

- `raw = 0.40 × 6.667 + 0.30 × 0.671 + 0.15 × 0 + 0.15 × 0.1 = 2.882`.
- `sigmoid(2.882) ≈ 0.94681`.
- `visibilitySigmoid ≈ 0.89362`.
- `V = round(100 × 0.89362) = 89`.

> V2 produces a more discriminating score for the same input.

## Visibility — empty response

`T = ""` → early return `{ score: 0, ... }`.

## Visibility — no mentions

`mentionRate = 0`, `firstPos = 0`, etc. → `raw = 0`, `sigmoid(0) = 0.5`, `visibilitySigmoid = 0`, `V = 0`.

## Sentiment heuristic — 3 positive, 1 negative

- `total = 4`, `raw = (3 − 1) / 4 = 0.5`.
- `S = round((0.5 + 1) × 50 × 100) / 100 = 75`.

## Sentiment heuristic — 0 mentions

`S = 0` (early return). **Not 50.** This is the intentional "no mention = no score" rule.

## Sentiment ABSA — one high-confidence positive

- `EntitySentiment { pPos: 0.85, pNeu: 0.10, pNeg: 0.05, confidence: 0.9 }`.
- `base = (0.85 − 0.05 + 1) × 50 = 90`.
- `shrinkage = 0.9` → `shrunken = 50 + (90 − 50) × 0.9 = 86`.
- `weightedSum = 86 × 0.9 = 77.4`; `totalWeight = 0.9`.
- `S = round(77.4 / 0.9 × 100) / 100 = 86`.

## Sentiment ABSA — low-confidence negative

- `EntitySentiment { pPos: 0.20, pNeu: 0.20, pNeg: 0.60, confidence: 0.4 }`.
- `base = (0.20 − 0.60 + 1) × 50 = 30`.
- `shrunken = 50 + (30 − 50) × 0.4 = 42`.
- `weightedSum = 42 × 0.4 = 16.8`; `totalWeight = 0.4`.
- `S = round(16.8 / 0.4 × 100) / 100 = 42`.

> Low confidence pulls the score toward 50.

## Sentiment ABSA — empty list

`sentiments.length === 0 → return 0`. **Not 50.**

## Position heuristic — single mention at rank 3

- score = 90. Average of one item is 90.

## Position heuristic — ranks [1, 4, 7]

- 1 → 100; 4 → 85; 7 → `80 × e^{−0.4} ≈ 80 × 0.6703 ≈ 53.6`.
- Average ≈ `(100 + 85 + 53.6) / 3 ≈ 79.5` → `P ≈ 79.5`.

## Position nDCG — ranks [1, 4, 7]

- `DCG = 1/log2(2) + 1/log2(5) + 1/log2(8) = 1 + 0.4307 + 0.3333 = 1.764`.
- `IDCG = 1/log2(2) + 1/log2(3) + 1/log2(4) = 1 + 0.6309 + 0.5 = 2.131`.
- `P = round(100 × 1.764 / 2.131) = round(82.78) = 83`.

> nDCG is gentler on bad ranks than the heuristic decay.

## Position nDCG — empty rankings

`return 0` (early guard).

## Position V2 — 3 groups, brand only in one

**Setup** (`POSITION_SCORING_VERSION = 'v2'`):
- Group `"Premium Airlines"` (relevant): brand at position 2 of 5.
- Group `"Budget Airlines"` (irrelevant): no brand.
- Group `"Charter Operators"` (relevant): no brand; size 4.

**Compute per group**:
- Premium: brandPresent = true. `nDCG_group = positionScoreFromRankings([{position:2}])`.
  - `DCG = 1/log2(3) ≈ 0.6309`; `IDCG = 1/log2(2) = 1` (one item, ideal at position 1); `P_group = round(63.09) = 63`. `contributes = true`.
- Budget: brandPresent = false; relevance = `'irrelevant'`. `nDCG_group = 0`. `contributes = false`.
- Charter: brandPresent = false; relevance = `'relevant'`. Penalty: position = `groupSize + 1 = 5`. `nDCG_group = round(100 × (1/log2(6)) / 1) = round(100 × 0.3868) = 39`. `contributes = true`.

**Final**: average of contributing scores = `(63 + 39) / 2 = 51`. → `P = 51`.

## Visibility — V1 vs V2 sanity check

For inputs where `mentionRate` is small and `firstPos` is high (mention right at the start), V2's lower weight on `mentionRate` means short, prominent mentions still score well via `firstPos × 0.30`, while V1 was already saturating because of `0.9 × mentionRate`. The two systems agree at extremes (everything → 100 or nothing → 0) and disagree most in the middle where calibration matters.

## Overall — typical mid-tier example

- V = 60, S = 70, P = 50.
- `O = (60 × 0.5 + 70 × 0.3 + 50 × 0.2) / 1.0 = 30 + 21 + 10 = 61`.

## Overall — brand absent

- V = 0, S = 0, P = 0 → O = 0.

## Citation self-bonus example (heuristic visibility)

- `selfCitationCount = 2`, `δ = 0.4`.
- `citationBonus = min(2, 3) / 3 = 0.667`.
- Adds `0.4 × 0.667 = 0.267` to `raw`. With baseline `raw = 1.5`, new `raw = 1.767` → small but real visibility uplift.

## LLM mode — visibility self-citation overlay

- LLM-V already produced 78. `selfCitationCount = 1`.
- `bonusPercent = 0.4 × (1/3) × 100 / 3 ≈ 4.44`.
- `boostedScore = 78 + 4.44 = 82.44` → cap & round to 82.44 (cap 100).

## Edge cases worth knowing

- **All-empty response** from a vendor returns `error: "Empty response from OpenAI ..."` → that item is excluded from scoring (no zero-poison). See `ai-executor.ts:124`.
- **Content-filtered response** (`finish_reason === 'content_filter'`) is treated as an error.
- **Repair attempt** in `generateJsonWithRepair` happens **once**; a second failure throws and the caller logs.
- **Heuristic-mode mention detection** requires whole-word boundary matches; an alias that is a substring of an unrelated word (e.g. brand "On" in "On the other hand") will not match because the regex is `\\b...\\b`.
- **Position V2 absence-but-relevant penalty** uses `groupSize + 1` — meaning a brand absent from a group of 5 relevant items is scored as if it ranked 6th. The penalty grows softer (logarithmically) as group size grows; this is by design.
- **Multiple mentions in one heading** are counted only once per mention via the `break` in `countHeadingListHits`.
