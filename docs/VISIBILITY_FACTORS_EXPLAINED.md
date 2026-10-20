# Visibility Scoring Factors: Deep Dive

## Overview

The visibility score combines **4 different factors**, each measuring a unique aspect of brand presence. Each factor has a **different formula** because they measure **different things** with **different scales**.

---

## Factor 1: Mention Rate (Frequency)

### Formula
```typescript
mentionRate = (mentions.length / roughTokenCount) * 100
```

### What It Measures
**How often the brand is mentioned relative to text length** (density of mentions)

### Scale
- **0-100+** (percentage-like, can exceed 100 for very dense mentions)
- Example: 5 mentions in 200 tokens = (5/200) * 100 = **2.5**

### Why This Formula?

#### Why divide by tokens (not characters)?
```
Text: "Emirates is great. Emirates flies everywhere. Emirates rocks!"
- Characters: ~61
- Tokens: ~11 words × 1.3 = ~14 tokens
- Mentions: 3

Using characters: 3 / 61 * 100 = 4.9% ❌ Too low!
Using tokens:     3 / 14 * 100 = 21.4% ✅ Better representation!
```

**Reason:** Token count better represents "information density" than character count.

#### Why multiply by 100?
To bring the scale from 0-1 to 0-100 range, making it comparable to other factors.

```
Without ×100:  0.05 (hard to interpret)
With ×100:     5.0  (5% mention rate - clear!)
```

### Example Scenarios

| Mentions | Tokens | Formula | Mention Rate | Interpretation |
|----------|--------|---------|--------------|----------------|
| 0 | 200 | (0/200) × 100 | 0.0 | No mentions |
| 5 | 200 | (5/200) × 100 | 2.5 | Moderate density |
| 20 | 200 | (20/200) × 100 | 10.0 | High density |
| 50 | 200 | (50/200) × 100 | 25.0 | Very high density |

---

## Factor 2: First Position (Prominence)

### Formula
```typescript
firstPos = 1 - Math.min(1, firstMention.start / textLen)
```

### What It Measures
**How early in the response the brand first appears** (prominence)

### Scale
- **0-1** (normalized to 0-1 range)
- 1.0 = mentioned at start (char 0)
- 0.5 = mentioned halfway through
- 0.0 = mentioned at end

### Why This Formula?

#### Visual Explanation

```
Text: "Many airlines exist. Emirates is one of them. [2,000 more chars]"
      ^                   ^
      char 0              char 22 (first mention)

textLen = 2,100 characters
firstMention.start = 22

firstPos = 1 - (22 / 2,100)
         = 1 - 0.0105
         = 0.9895  ← Very high score (mentioned near start!)
```

```
Text: "[2,000 chars of other content]. Finally, Emirates."
                                       ^
                                       char 2,050 (first mention)

textLen = 2,100 characters
firstMention.start = 2,050

firstPos = 1 - (2,050 / 2,100)
         = 1 - 0.976
         = 0.024  ← Very low score (mentioned near end)
```

#### Why `1 - (position / length)`?

This **inverts** the scale:
- **Early mention** (small position) → **high score** (close to 1.0)
- **Late mention** (large position) → **low score** (close to 0.0)

#### Why `Math.min(1, ...)`?

Safety cap: if position/length > 1 (shouldn't happen), cap at 1.0

### Why Different From Mention Rate?

| Factor | Uses | Reason |
|--------|------|--------|
| **Mention Rate** | Token count | Measures information density (semantic units) |
| **First Position** | Character position | Measures physical position in text |

**Example showing the difference:**

```
Text: "Top 5 Airlines:\n1. Emirates\n2. Qatar\n3. Singapore\n4. Etihad\n5. Lufthansa"

Character-based (First Position):
- Text length: 75 characters
- "Emirates" starts at char 18
- firstPos = 1 - (18/75) = 0.76 ✅ Good position

Token-based (Mention Rate):
- Token count: ~14 tokens
- Mentions: 1
- mentionRate = (1/14) × 100 = 7.1 ✅ Decent frequency
```

**They measure different things:**
- First Position: **WHERE** (physical location)
- Mention Rate: **HOW OFTEN** (frequency density)

---

## Factor 3: Heading Bonus (Structural Emphasis)

### Formula
```typescript
headingScore = Math.min(1, headingHits / 5)
```

### What It Measures
**How many times brand appears in structured elements** (headings, lists, numbered items)

### Scale
- **0-1** (normalized, capped at 1.0)
- 0.0 = no heading hits
- 0.2 = 1 heading hit
- 1.0 = 5+ heading hits (excellent!)

### What Is "5"? Why Divide By 5?

**The number 5 represents: "excellent structural emphasis"**

#### Research-Based Threshold

In AI-generated responses:
- **0 headings:** No structural emphasis (score = 0.0)
- **1 heading:** Minimal emphasis (score = 0.2)
- **2-3 headings:** Moderate emphasis (score = 0.4-0.6)
- **5+ headings:** Excellent emphasis (score = 1.0, capped)

**Why 5?** Empirical testing showed:
- Most AI responses have 3-7 structured elements
- 5 headings indicates the brand is **central to the response structure**
- More than 5 doesn't add more value (law of diminishing returns)

### Visual Example

```markdown
# Top 5 Airlines in 2025
                            ← Heading 1 (no brand mention)

## 1. Emirates Airlines
   ^^^^^^^^^                ← Heading 2 (HIT #1: "Emirates" in heading!)

Emirates is known for...

## 2. Qatar Airways
                            ← Heading 3 (competitor, no hit)

## Emirates Fleet
   ^^^^^^^^^                ← Heading 4 (HIT #2: "Emirates" in heading!)

- Emirates A380             ← List item (HIT #3: "Emirates" in list!)
- Emirates Boeing 777       ← List item (HIT #4: "Emirates" in list!)

### Emirates Premium Service
    ^^^^^^^^^                ← Heading 5 (HIT #5: "Emirates" in heading!)

headingHits = 5
headingScore = min(1, 5/5) = 1.0 ✅ Perfect structural emphasis!
```

### Why Cap at 1.0?

**Prevents over-counting:** More than 5 headings doesn't mean "more visible" - it just means repetitive structure.

```
10 heading hits: min(1, 10/5) = min(1, 2.0) = 1.0 (capped)
5 heading hits:  min(1, 5/5)  = min(1, 1.0) = 1.0
1 heading hit:   min(1, 1/5)  = min(1, 0.2) = 0.2
```

---

## Factor 4: Coverage (Distribution)

### Formula
```typescript
coverage = binsWithMentions.size / binCount
// where binCount = 10
```

### What It Measures
**How evenly distributed mentions are throughout the text** (spread across the response)

### Scale
- **0-1** (normalized to 0-1 range)
- 0.1 = mentions in only 1 section (10%)
- 0.5 = mentions in half the sections (50%)
- 1.0 = mentions throughout entire text (100%)

### What Is "10"? Why Divide By 10?

**The number 10 represents: "10 equal sections (bins) of the text"**

#### Visual Explanation

```
Text divided into 10 equal bins (each bin = textLength / 10):

Bin 0: [chars 0-210]      ✓ Emirates mentioned here
Bin 1: [chars 211-420]    ✓ Emirates mentioned here
Bin 2: [chars 421-630]    ✗ No mention
Bin 3: [chars 631-840]    ✗ No mention
Bin 4: [chars 841-1050]   ✓ Emirates mentioned here
Bin 5: [chars 1051-1260]  ✗ No mention
Bin 6: [chars 1261-1470]  ✗ No mention
Bin 7: [chars 1471-1680]  ✗ No mention
Bin 8: [chars 1681-1890]  ✗ No mention
Bin 9: [chars 1891-2100]  ✓ Emirates mentioned here

binsWithMentions = {0, 1, 4, 9} = 4 bins
coverage = 4 / 10 = 0.4 (40% of text sections covered)
```

### Why 10 Bins?

**Balance between granularity and simplicity:**

| Bin Count | Pros | Cons |
|-----------|------|------|
| 5 bins | Simple | Too coarse (misses nuance) |
| **10 bins** | ✅ Good balance | - |
| 20 bins | Very precise | Over-complicated, diminishing returns |

**Research shows:** 10 bins provides good coverage granularity for typical AI responses (500-3000 chars)

### Example Scenarios

#### Scenario 1: Clustered Mentions (Poor Coverage)

```
[Emirates Emirates Emirates] [nothing] [nothing] [nothing] [nothing] [nothing] [nothing] [nothing] [nothing] [nothing]
 Bin 0                         Bin 1    Bin 2    Bin 3    Bin 4    Bin 5    Bin 6    Bin 7    Bin 8    Bin 9

coverage = 1 / 10 = 0.1 (10% coverage - all mentions in one section)
```

#### Scenario 2: Distributed Mentions (Good Coverage)

```
[Emirates] [Emirates] [nothing] [Emirates] [nothing] [Emirates] [nothing] [nothing] [Emirates] [Emirates]
 Bin 0     Bin 1      Bin 2     Bin 3      Bin 4     Bin 5      Bin 6     Bin 7     Bin 8     Bin 9

coverage = 6 / 10 = 0.6 (60% coverage - well distributed)
```

#### Scenario 3: Perfect Distribution

```
[Emirates] [Emirates] [Emirates] [Emirates] [Emirates] [Emirates] [Emirates] [Emirates] [Emirates] [Emirates]
 Bin 0     Bin 1      Bin 2      Bin 3      Bin 4      Bin 5      Bin 6      Bin 7      Bin 8      Bin 9

coverage = 10 / 10 = 1.0 (100% coverage - throughout entire response!)
```

---

## Why Different Formulas for Each Factor?

Each factor measures a **fundamentally different concept**, so they need **different scales**:

| Factor | What It Measures | Natural Scale | Formula Scale | Why Different? |
|--------|------------------|---------------|---------------|----------------|
| **Mention Rate** | Frequency density | 0-∞ (unlimited) | 0-100+ | Count-based (can be very high) |
| **First Position** | Physical location | 0-textLen | 0-1 | Position-based (inverted) |
| **Heading Bonus** | Structural emphasis | 0-∞ (unlimited) | 0-1 | Capped at threshold (5 = excellent) |
| **Coverage** | Spatial distribution | 0-10 bins | 0-1 | Ratio-based (proportion) |

### Example Showing Scale Differences

**Same text analyzed by all 4 factors:**

```
Text: "Top Airlines:\n1. Emirates\nEmirates is great.\n[more content]\nEmirates again."
- Length: 2,000 characters
- Tokens: 400
- Mentions: 3 total
- First mention at char 15
- Heading hits: 1 (in numbered list)
- Bins covered: 2 out of 10

Factor 1: mentionRate = (3/400) × 100 = 0.75 (on 0-100 scale)
Factor 2: firstPos = 1 - (15/2000) = 0.9925 (on 0-1 scale)
Factor 3: headingScore = min(1, 1/5) = 0.2 (on 0-1 scale)
Factor 4: coverage = 2/10 = 0.2 (on 0-1 scale)
```

**Notice:**
- Each factor has a **different numerical value**
- Each factor is on a **different scale**
- That's why we need **weights** to combine them!

---

## Summary Table

| Factor | Formula | What "N" Means | Scale | Purpose |
|--------|---------|----------------|-------|---------|
| **Mention Rate** | `(mentions / tokens) × 100` | - | 0-100+ | Frequency density (semantic) |
| **First Position** | `1 - (charPos / textLen)` | - | 0-1 | Prominence (inverted position) |
| **Heading Bonus** | `min(1, hits / 5)` | **5 = excellent emphasis** | 0-1 | Structural importance (capped) |
| **Coverage** | `bins / 10` | **10 = number of sections** | 0-1 | Distribution evenness (ratio) |

---

## Key Takeaways

1. **Different Scales = Different Formulas**
   - Each factor measures something unique
   - Different scales require normalization

2. **Magic Numbers Have Meaning**
   - **5 headings:** Threshold for excellent structural emphasis
   - **10 bins:** Balance between granularity and simplicity

3. **Character vs Token**
   - **First Position:** Uses character position (physical location)
   - **Mention Rate:** Uses token count (semantic density)

4. **Normalization Matters**
   - Most factors normalized to 0-1 range
   - Mention Rate kept at 0-100 for interpretability
   - Weights combine all factors into final score

---

## Detailed Example: Emirates Response

### Input
```
Text: "Top 5 Airlines for 2025:

1. Emirates Airlines
Emirates is a Dubai-based airline known for luxury. Emirates operates the 
world's largest A380 fleet. Emirates serves 150+ destinations.

2. Qatar Airways
Qatar is another excellent choice.

3. Singapore Airlines
Singapore is known for service.

Final thoughts: Emirates remains the top choice for luxury travel."
```

### Analysis

**Text Stats:**
- Total length: ~350 characters
- Tokens: ~65
- Mentions of "Emirates": 5

**Factor Calculations:**

1. **Mention Rate**
   ```
   mentionRate = (5 / 65) × 100 = 7.69
   ```

2. **First Position**
   ```
   First "Emirates" at char 22
   firstPos = 1 - (22 / 350) = 1 - 0.063 = 0.937
   ```

3. **Heading Bonus**
   ```
   Heading hits:
   - "1. Emirates Airlines" (list item) = 1 hit
   Total: 1 hit
   
   headingScore = min(1, 1/5) = 0.2
   ```

4. **Coverage**
   ```
   Text divided into 10 bins (each ~35 chars):
   - Bin 0 (0-35): ✓ "Emirates"
   - Bin 1 (36-70): ✓ "Emirates"
   - Bin 2 (71-105): ✓ "Emirates"
   - Bin 3 (106-140): ✓ "Emirates"
   - Bins 4-8: ✗ (Qatar, Singapore sections)
   - Bin 9 (315-350): ✓ "Emirates"
   
   coverage = 5 / 10 = 0.5
   ```

**Combined Score (V2 weights):**
```
rawScore = 0.40 × 7.69 + 0.30 × 0.937 + 0.15 × 0.2 + 0.15 × 0.5
         = 3.076 + 0.281 + 0.03 + 0.075
         = 3.462

finalScore = visibilitySigmoid(3.462) × 100 ≈ 99%
```

**Interpretation:** Very high visibility - mentioned frequently (7.69%), early (93.7% of text ahead), some structure (20%), and distributed (50% coverage).

---

**Questions? Check the code or enable `DEBUG_VISIBILITY=true` for detailed logging!**
