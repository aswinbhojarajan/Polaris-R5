# Visibility Scoring V2: Normalized Weights

## Overview

This document explains the V2 visibility scoring implementation with mathematically correct normalized weights.

## What Changed?

### Problem with V1 (Legacy)

The original visibility scoring used weights that summed to **2.4** instead of **1.0**:

```typescript
// V1 Weights (sum = 2.4)
mentionRate:   0.9  (37.5% actual contribution)
firstPosition: 0.6  (25.0% actual contribution)
headingBonus:  0.4  (16.7% actual contribution)
coverage:      0.5  (20.8% actual contribution)
```

**Issues:**
- Weights don't represent actual % contribution
- Score distribution depends on sigmoid behavior
- Difficult to tune and interpret
- Not standard practice in scoring systems

### Solution: V2 (Normalized)

V2 uses weights that sum to **1.0**, where each weight represents the actual % contribution:

```typescript
// V2 Weights (sum = 1.0)
mentionRate:   0.40  (40% contribution - how often brand is mentioned)
firstPosition: 0.30  (30% contribution - how early brand appears)
headingBonus:  0.15  (15% contribution - structural emphasis)
coverage:      0.15  (15% contribution - distribution throughout text)
```

**Benefits:**
- ✅ Mathematically correct
- ✅ Each weight = % contribution to final score
- ✅ Easier to interpret and tune
- ✅ Standard practice in ML/IR scoring
- ✅ Better score distribution (0-100 range)

## Weight Rationale

| Component | Weight | Justification |
|-----------|--------|---------------|
| **Mention Rate** | 40% | Frequency is the strongest signal of visibility - how many times the brand is mentioned relative to text length |
| **First Position** | 30% | Early mentions indicate prominence - appearing at the start of a response signals importance |
| **Heading Bonus** | 15% | Structural placement matters - mentions in headings/lists show organization around the brand |
| **Coverage** | 15% | Distribution is useful - appearing throughout the response is better than clustering in one section |

## How to Switch Between V1 and V2

### Default Behavior (V1 - Legacy)

By default, the system uses V1 scoring for backward compatibility:

```bash
# No environment variable needed - defaults to V1
npm run dev
```

### Enable V2 Scoring

Set the environment variable in your `.env` file:

```bash
# .env
VISIBILITY_SCORING_VERSION=v2
```

Or export it before running:

```bash
export VISIBILITY_SCORING_VERSION=v2
npm run dev
```

### Enable Debug Logging

To see detailed scoring breakdowns:

```bash
# .env
VISIBILITY_SCORING_VERSION=v2
DEBUG_VISIBILITY=true
```

This will log:
- Individual factor scores (mention rate, first position, heading bonus, coverage)
- Weighted contributions (how much each factor contributes to raw score)
- Raw score before sigmoid
- Final score after sigmoid

## Expected Score Differences

V2 scores will be **lower** than V1 scores for the same input, but **more accurate**:

### Example: Emirates in "Top 5 Airlines"

**Input:**
- 13 mentions in 2,823 characters
- First mention at position 84 (early)
- 1 heading hit
- Coverage: 0.2 (2 out of 10 bins)

**V1 Score:** ~60.0
**V2 Score:** ~41.0

**Why the difference?**
- V1 weights (sum=2.4) push rawScore higher → sigmoid gets larger input → inflated scores
- V2 weights (sum=1.0) produce proper normalization → better distribution

## Impact on Competitor Scoring

**Good news:** Competitor scoring automatically uses the same visibility calculation!

The `competitor-scoring.ts` service calls `calculateVisibilityScoreAsync()`, which now routes to V2 when enabled. This means:

- ✅ Both client and competitor scores use the same formula
- ✅ No separate migration needed
- ✅ Consistent comparison across all entities
- ✅ Single flag controls both

## Testing Strategy

### Test 1: Verify V1 Still Works (Baseline)

```bash
# Don't set VISIBILITY_SCORING_VERSION or set it to v1
npm run dev

# Run a prompt run for a client
# Note the visibility scores
# These should match historical data
```

### Test 2: Compare V1 vs V2

```bash
# Step 1: Run with V1
export VISIBILITY_SCORING_VERSION=v1
npm run dev
# Execute a prompt run, note the scores

# Step 2: Run with V2
export VISIBILITY_SCORING_VERSION=v2
export DEBUG_VISIBILITY=true
npm run dev
# Execute the SAME prompt run, compare scores
```

### Test 3: Verify Competitor Scoring

```bash
export VISIBILITY_SCORING_VERSION=v2
npm run dev

# Run a prompt run that includes competitor discovery
# Check the competitor scores in the dashboard
# They should use V2 scoring automatically
```

## Rollback Plan

If V2 causes issues, instant rollback:

```bash
# .env
VISIBILITY_SCORING_VERSION=v1  # or remove the line entirely
```

No code changes needed - just restart the server.

## Migration Checklist

When you're ready to fully migrate to V2:

- [ ] Test V2 on staging/dev environment
- [ ] Compare scores with sample prompt runs
- [ ] Verify competitor scoring works correctly
- [ ] Update composer weights if needed (see below)
- [ ] Monitor score distribution in production
- [ ] Update documentation/user guides with new score ranges

## Composer Weights Update (Optional)

The composer combines visibility, sentiment, and position scores:

```typescript
// Current composer weights (in server/config/aeo.ts)
visibility: 0.5  (50%)
sentiment:  0.3  (30%)
position:   0.2  (20%)
```

**Recommendation:** If V2 visibility scores are consistently lower, consider adjusting:

```typescript
// Suggested adjustment for V2
visibility: 0.35  (35%)
sentiment:  0.25  (25%)
position:   0.40  (40%)
```

This gives more weight to position scores and balances the overall scoring.

## Architecture Notes

### File Structure

```
server/
├── config/
│   └── visibility-weights.ts         # Weight configurations (V1, V2)
├── services/
│   ├── visibility-scoring.ts         # Main entry point + routing
│   ├── visibility-scoring-v2.ts      # V2 implementation (normalized)
│   └── visibilityScorer.new.ts       # V1 implementation (legacy)
```

### Design Principles

1. **Backward Compatible:** V1 code is untouched, still works
2. **Feature Flag:** Single env variable controls version
3. **Lazy Loading:** V2 module only loaded when needed
4. **Fail Safe:** Invalid weights fall back to V1
5. **Observable:** Debug logging for transparency

## Troubleshooting

### Q: Why are V2 scores lower than V1?

**A:** V2 uses proper normalization. V1 inflated scores due to weights summing to 2.4. V2 scores are more accurate.

### Q: Will this break existing dashboards?

**A:** No. Set `VISIBILITY_SCORING_VERSION=v1` to keep current behavior. V2 is opt-in.

### Q: Can I test both versions side-by-side?

**A:** Yes. Run two prompt runs with different env variables and compare.

### Q: What if weights don't sum to 1.0?

**A:** V2 validates weights at runtime and throws an error. This prevents misconfiguration.

### Q: How do I tune the weights?

**A:** Edit `VISIBILITY_WEIGHTS_V2` in `server/config/visibility-weights.ts`. Make sure they sum to 1.0.

## References

- **Implementation:** `server/services/visibility-scoring-v2.ts`
- **Configuration:** `server/config/visibility-weights.ts`
- **Routing:** `server/services/visibility-scoring.ts:calculateVisibilityScoreWithMentionsVersioned()`
- **Usage:** `server/services/competitor-scoring.ts` (line 171)

## Next Steps

1. ✅ **V2 Implementation Complete** - Code is ready
2. 🧪 **Testing Phase** - Validate V2 on dev environment
3. 📊 **Score Analysis** - Compare V1 vs V2 distribution
4. 🚀 **Production Rollout** - Enable V2 when ready
5. 🗑️ **Deprecate V1** - Eventually remove legacy code

---

**Questions?** Check the code comments or enable `DEBUG_VISIBILITY=true` for detailed logging.
