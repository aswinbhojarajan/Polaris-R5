# Position Score: Complete Explanation

## 🎯 What Is Position Score?

**Position Score measures how highly your brand ranks in structured lists and comparisons within AI responses.**

Key concept: Being **#1 in a Top 5 list** = better than being **#5**

---

## 📋 Table of Contents

1. [Step 1: Ranking Detection](#step-1-ranking-detection)
2. [Step 2: Brand Filtering](#step-2-brand-filtering)
3. [Step 3: nDCG Calculation](#step-3-ndcg-calculation)
4. [Complete Example](#complete-example)
5. [Common Issues](#common-issues)
6. [Debugging Production vs Development](#debugging-production-vs-development)

---

## Step 1: Ranking Detection

The system detects rankings using **pattern matching** or **LLM extraction** based on `AEO_MODE`.

### Detection Methods

#### Method A: Heuristic (Pattern Matching)

Detects **4 types** of structured content:

| Pattern | Example | How It Works |
|---------|---------|--------------|
| **Numbered Lists** | `1. Emirates`<br>`2. Qatar` | Regex: `(\d+)\.\s*([^\n\r]+)` |
| **Parenthesis Lists** | `1) Emirates`<br>`2) Qatar` | Regex: `(\d+)\)\s*([^\n\r]+)` |
| **Bullet Lists** | `- Emirates`<br>`- Qatar` | Regex: `^[-*•]\s*([^\n\r]+)` (position assigned sequentially) |
| **Comparative Words** | `Top airlines include Emirates`<br>`Best choice: Emirates` | Regex: `\b(?:top\|best\|leading\|first)\s+([^.!?]+)` (all get position 1) |

**Example Text:**
```
Top 5 Airlines:
1. Emirates
2. Qatar Airways
3. Singapore Airlines
```

**Heuristic Detection Result:**
```javascript
rankings = [
  { item: "Emirates", position: 1 },
  { item: "Qatar Airways", position: 2 },
  { item: "Singapore Airlines", position: 3 }
]
```

#### Method B: LLM Extraction (OpenAI/Anthropic)

Uses AI to understand **context and implied rankings**:

**Example Text:**
```
For luxury travel, Emirates leads the pack, followed by Qatar.
Singapore Airlines is also a strong contender.
```

**LLM Detection Result:**
```javascript
rankings = [
  { item: "Emirates", position: 1, confidence: 0.95 },
  { item: "Qatar", position: 2, confidence: 0.90 },
  { item: "Singapore Airlines", position: 3, confidence: 0.85 }
]
```

**When LLM Is Used:**
- `AEO_MODE=llm` or `AEO_MODE=hybrid`
- Heuristic finds < 3 items with confidence < 0.7
- Falls back to heuristic if LLM fails

---

## Step 2: Brand Filtering

**CRITICAL:** Only rankings mentioning the brand (or aliases) count!

### Filtering Logic

```typescript
brandRankings = rankings.filter(r => {
  const itemLower = r.item.toLowerCase();
  const nameLower = brandName.toLowerCase(); // "emirates"
  
  // Direct match
  if (itemLower.includes(nameLower)) return true;
  
  // Alias match
  for (const alias of aliases) { // ["emirates airlines", "ek"]
    if (itemLower.includes(alias.toLowerCase())) {
      return true;
    }
  }
  
  return false;
});
```

### Example

**All Detected Rankings:**
```javascript
rankings = [
  { item: "Emirates", position: 1 },
  { item: "Qatar Airways", position: 2 },
  { item: "Singapore Airlines", position: 3 },
  { item: "Emirates A380 Fleet", position: 1 }, // Different list
  { item: "Lufthansa", position: 4 }
]
```

**After Brand Filtering** (brand = "Emirates"):
```javascript
brandRankings = [
  { item: "Emirates", position: 1 },
  { item: "Emirates A380 Fleet", position: 1 }
]
```

**If No Brand Matches:**
```javascript
brandRankings = [] // Empty array!
positionScore = 0  // ⚠️ This is why you might see 0.0 in production
```

---

## Step 3: nDCG Calculation

**nDCG = Normalized Discounted Cumulative Gain**

Standard information retrieval metric used by Google, Bing, etc.

### Formula Breakdown

#### 3.1 DCG (Discounted Cumulative Gain)

```
DCG = Σ (relevance / log₂(1 + position))
```

- **relevance** = 1 (brand mentioned = relevant)
- **position** = ranking position (1, 2, 3, etc.)
- **log₂** = logarithm base 2 (penalizes lower positions)

**Why Logarithm?**
- Position 1 → Position 2: Big difference (lose 50% of value)
- Position 5 → Position 6: Small difference (lose ~15% of value)
- Reflects reality: Users care way more about #1 vs #2 than #9 vs #10

#### 3.2 Ideal DCG (Best Possible Score)

```
Ideal DCG = Σ (1 / log₂(1 + i)) for i = 1 to N
```

Where N = number of brand mentions

**Represents:** If all your brand rankings were at positions 1, 2, 3, ..., N

#### 3.3 nDCG (Normalized)

```
nDCG = DCG / Ideal DCG
```

- **Range:** 0.0 to 1.0
- **0.0** = Worst possible (all low positions)
- **1.0** = Perfect (all top positions)

#### 3.4 Final Score

```
Position Score = round(nDCG × 100)
```

- **Range:** 0 to 100
- **100** = Perfect positioning
- **0** = No rankings found (or very poor)

---

## Complete Example

### Scenario: Emirates in "Top 5 Airlines" Prompt

**AI Response:**
```
Top 5 Airlines for 2025:

1. Emirates
Emirates offers exceptional service with A380 fleet.

2. Qatar Airways
Qatar is known for premium economy.

3. Singapore Airlines
Singapore excels in customer satisfaction.

4. ANA
ANA provides excellent Asian routes.

5. Emirates Skywards Loyalty Program
```

### Step-by-Step Calculation

#### Step 1: Detect Rankings

```javascript
allRankings = [
  { item: "Emirates", position: 1 },
  { item: "Qatar Airways", position: 2 },
  { item: "Singapore Airlines", position: 3 },
  { item: "ANA", position: 4 },
  { item: "Emirates Skywards Loyalty Program", position: 5 }
]
```

#### Step 2: Filter for Brand "Emirates"

```javascript
brandRankings = [
  { item: "Emirates", position: 1 },
  { item: "Emirates Skywards Loyalty Program", position: 5 }
]
```

N = 2 (two brand mentions in rankings)

#### Step 3: Calculate DCG (Actual)

```
DCG = (1 / log₂(1+1)) + (1 / log₂(1+5))
    = (1 / log₂(2)) + (1 / log₂(6))
    = (1 / 1.0) + (1 / 2.585)
    = 1.0 + 0.387
    = 1.387
```

#### Step 4: Calculate Ideal DCG

If both rankings were at positions 1 and 2 (best possible):

```
Ideal DCG = (1 / log₂(1+1)) + (1 / log₂(1+2))
          = (1 / log₂(2)) + (1 / log₂(3))
          = (1 / 1.0) + (1 / 1.585)
          = 1.0 + 0.631
          = 1.631
```

#### Step 5: Calculate nDCG

```
nDCG = DCG / Ideal DCG
     = 1.387 / 1.631
     = 0.850
```

#### Step 6: Final Score

```
Position Score = round(0.850 × 100)
              = round(85.0)
              = 85
```

**Result: Position Score = 85/100** ✅

---

## Score Interpretation Table

| Position Score | Interpretation | Example Scenarios |
|----------------|----------------|-------------------|
| **100** | Perfect | All brand mentions are #1 |
| **90-99** | Excellent | Mostly #1, occasional #2 |
| **80-89** | Very Good | Mix of #1, #2, #3 positions |
| **70-79** | Good | Consistently in top 3 |
| **50-69** | Moderate | Mix of top 5 positions |
| **30-49** | Below Average | Ranked but not in top positions |
| **1-29** | Poor | Very low rankings (#8, #9, #10) |
| **0** | None | ⚠️ **No rankings detected** |

---

## Common Issues

### Issue 1: Position Score = 0.0

**Why This Happens:**

```javascript
brandRankings = [] // No rankings found!
```

**Possible Causes:**

| Cause | Example | Solution |
|-------|---------|----------|
| **No structured lists** | "Emirates is great but not ranked" | Can't fix - response has no rankings |
| **Brand name mismatch** | Response says "EK" but brand is "Emirates" | Add "EK" to aliases |
| **Heuristic misses** | "Emirates leads the industry" (no numbers) | Use `AEO_MODE=llm` for better detection |
| **LLM mode disabled** | Complex ranking not detected | Enable `AEO_MODE=llm` or `hybrid` |

### Issue 2: Rankings Detected But Not Sorted in UI

**Example Screenshot Issue:**
```
Detected Rankings:
- Position 5: Emirates Skywards
- Position 1: Emirates
- Position 2: Qatar
```

**Why:** Rankings are sorted by position in backend, but UI might display in detection order.

**Fix:** Frontend should sort by `position` field:

```typescript
// In client code
const sortedRankings = rankings.sort((a, b) => a.position - b.position);
```

### Issue 3: Production = 0.0, Development = 92.0

**Root Causes:**

1. **Different AEO_MODE:**
   - Production: `AEO_MODE=heuristic` (misses complex rankings)
   - Development: `AEO_MODE=llm` (detects more rankings)

2. **Different AI Responses:**
   - Production uses cached/old responses
   - Development generates fresh responses

3. **Missing OpenAI API Key:**
   - Production: LLM mode fails, falls back to heuristic
   - Development: LLM mode works

4. **Different Brand Aliases:**
   - Production: Aliases not configured
   - Development: Aliases include more variations

---

## Debugging Production vs Development

### Step 1: Check AEO Mode

**Production:**
```bash
# SSH into production or check logs
echo $AEO_MODE
# or
cat .env | grep AEO_MODE
```

**Development:**
```bash
# Check local environment
echo $AEO_MODE
# Expected: llm or hybrid
```

### Step 2: Inspect Raw Response

**Check what the AI actually returned:**

```sql
-- Get the raw response for a specific answer
SELECT 
  p.text AS prompt,
  a.raw_response,
  a.position_score
FROM answers a
JOIN prompt_run_items pri ON a.prompt_run_item_id = pri.id
JOIN prompts p ON pri.prompt_id = p.id
WHERE pri.prompt_run_id = 'YOUR_PROMPT_RUN_ID'
LIMIT 1;
```

### Step 3: Manual Ranking Detection Test

**Copy the raw response and test locally:**

```typescript
// test-ranking-detection.ts
import { parseRankingsAsync } from './server/services/ranking-parser';

const rawResponse = `PASTE_YOUR_RAW_RESPONSE_HERE`;
const brandName = "Emirates";
const aliases = ["Emirates Airlines", "EK"];

const rankings = await parseRankingsAsync(rawResponse, brandName, aliases);
console.log('All Rankings:', rankings);

const brandRankings = rankings.filter(r => {
  const itemLower = r.item.toLowerCase();
  return itemLower.includes(brandName.toLowerCase()) ||
         aliases.some(a => itemLower.includes(a.toLowerCase()));
});

console.log('Brand Rankings:', brandRankings);
console.log('Position Score:', positionScoreFromRankings(brandRankings));
```

### Step 4: Check Rankings Table

**See what was actually saved:**

```sql
SELECT 
  r.item,
  r.position,
  a.position_score
FROM rankings r
JOIN answers a ON r.answer_id = a.id
JOIN prompt_run_items pri ON a.prompt_run_item_id = pri.id
WHERE pri.prompt_run_id = 'YOUR_PROMPT_RUN_ID'
ORDER BY r.position ASC;
```

### Step 5: Compare Environments

| Check | Production | Development | Expected |
|-------|-----------|-------------|----------|
| AEO_MODE | ? | ? | Should match |
| OPENAI_API_KEY | Set? | Set? | Both should have it |
| Brand Aliases | Count? | Count? | Should match |
| Rankings Count | 0? | 5? | Should be similar |

---

## Visual Example: nDCG Score Comparison

### Scenario A: Perfect Score (100)

```
Brand mentioned at positions: 1, 2
DCG = 1.0 + 0.631 = 1.631
Ideal DCG = 1.0 + 0.631 = 1.631
nDCG = 1.631 / 1.631 = 1.0
Score = 100
```

### Scenario B: Good Score (85)

```
Brand mentioned at positions: 1, 5
DCG = 1.0 + 0.387 = 1.387
Ideal DCG = 1.0 + 0.631 = 1.631
nDCG = 1.387 / 1.631 = 0.85
Score = 85
```

### Scenario C: Poor Score (34)

```
Brand mentioned at positions: 8, 10
DCG = 0.333 + 0.289 = 0.622
Ideal DCG = 1.0 + 0.631 = 1.631
nDCG = 0.622 / 1.631 = 0.38
Score = 38
```

### Scenario D: Zero Score (0)

```
Brand mentioned at positions: [] (empty)
DCG = 0
Ideal DCG = 0
nDCG = 0 / 0 → 0 (by definition)
Score = 0
```

---

## Headline vs Ranking Confusion

### What Are "Headlines"?

**Headlines** = Detected in **Visibility Score** (Heading Bonus factor)

**Rankings** = Detected for **Position Score** (nDCG calculation)

**They're Different!**

| Feature | Headlines (Visibility) | Rankings (Position) |
|---------|----------------------|---------------------|
| **Purpose** | Count structural emphasis | Measure competitive positioning |
| **Detection** | `# Emirates`, `- Emirates` | `1. Emirates`, `Top: Emirates` |
| **Scoring** | headingScore = min(1, hits/5) | positionScore = nDCG |
| **Factor** | Part of Visibility (15% weight) | Standalone Position Score |

**Example:**

```markdown
# Top Airlines in 2025

## 1. Emirates              ← Both HEADLINE and RANKING #1
Emirates is the best.

- Emirates A380             ← HEADLINE only (no position)
- Emirates Skywards         ← HEADLINE only (no position)

## 2. Qatar Airways         ← HEADLINE and RANKING #2
```

**Visibility Heading Hits:** 4 (all `#` and `-` mentions)
**Position Rankings:** 2 (only `1. Emirates` and `2. Qatar Airways`)

---

## Quick Reference: Position Score Formula

```typescript
function calculatePositionScore(brandRankings) {
  if (brandRankings.length === 0) return 0;
  
  // Actual DCG
  let dcg = 0;
  for (const r of brandRankings) {
    dcg += 1 / Math.log2(1 + r.position);
  }
  
  // Ideal DCG (if at positions 1, 2, 3, ...)
  let idealDcg = 0;
  for (let i = 1; i <= brandRankings.length; i++) {
    idealDcg += 1 / Math.log2(1 + i);
  }
  
  // Normalize and scale to 0-100
  const ndcg = dcg / idealDcg;
  return Math.round(ndcg * 100);
}
```

---

## Action Items for Your Issue

Based on your screenshots (Production = 0.0, Development = 92.0):

1. ✅ **Check if rankings were detected in production:**
   ```sql
   SELECT COUNT(*) FROM rankings WHERE answer_id IN (
     SELECT id FROM answers WHERE prompt_run_item_id IN (
       SELECT id FROM prompt_run_items WHERE prompt_run_id = 'PROD_RUN_ID'
     )
   );
   ```

2. ✅ **Compare AEO_MODE:**
   ```bash
   # Production
   echo $AEO_MODE
   
   # Development
   echo $AEO_MODE
   ```

3. ✅ **Check if brand name matches response text:**
   - Does production response say "Emirates" or "EK"?
   - Are aliases configured in production?

4. ✅ **Enable debug logging:**
   ```bash
   # Add to .env (both environments)
   DEBUG_AEO=true
   ```
   
   Then check logs for ranking detection details.

---

**Need help debugging? Share:**
1. Raw AI response text (from production)
2. Brand name and aliases
3. AEO_MODE setting
4. Rankings count from database

I can pinpoint exactly why production shows 0.0!
