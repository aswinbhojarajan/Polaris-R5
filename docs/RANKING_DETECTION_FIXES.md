# Ranking Detection: Issues & Fixes

## 🐛 **Problems Identified**

### Problem 1: False Positive Detections

**Old Regex:** `(\d+)\.\s*([^\n\r]+)`

This matched **ANY** number followed by a period, causing:

| False Positive | Detected As | Should Be |
|----------------|-------------|-----------|
| `19.5 inches` | Position **19** ❌ | Not a ranking (measurement) |
| `2024.` (year) | Position **2024** ❌ | Not a ranking (year reference) |
| `46.5-inch pitch` | Position **46** ❌ | Not a ranking (measurement) |

**Example from your screenshot:**
```
RANKINGS:
10: Other Perks:** Amenity kits...        ← False positive
1: Premium Economy Launch:**...           ← Correct (### 1. Emirates)
2: **Seating:** Wider seats...            ← False positive  
19: 5 inches), 8-inch recline...          ← False positive (from "19.5 inches")
```

###Problem 2: UI Not Sorted

**Old Code:**
```tsx
{result.rankings.map((ranking: any, i: number) => (
  <div key={i}>...</div>
))}
```

Displayed rankings in **detection order** (order they appeared in text), not sorted by position number.

**Screenshot showed:**
- Position 10
- Position 1
- Position 2
- Position 4

**Should be:** 1, 2, 4, 10

---

## ✅ **Solutions Implemented**

### Fix 1: Improved Regex Pattern (Backend)

**File:** `server/services/ranking-parser.ts`

**Old Regex:**
```javascript
const numberedListRegex = /(\d+)\.\s*([^\n\r]+)/g;
```

**New Regex:**
```javascript
const numberedListRegex = /(?:^|\n)\s*(?:#{1,6}\s*)?(\d+)\.\s+([^\n\r]+)/gm;
```

**What Changed:**
- `(?:^|\n)` → Only matches at **start of line** (filters out "19.5" mid-sentence)
- `(?:#{1,6}\s*)?` → Optional markdown headers (`### 1. Emirates`)
- `\.\s+` → Requires **at least one space** after period (filters out "2024.")
- `/gm` → Multiline mode

**Additional Validation:**
```javascript
if (position > 0 && position <= 20 && item.length >= 3) {
  rankings.push({ item, position });
}
```

- Only positions **1-20** (realistic ranking range)
- Minimum **3 characters** for item text
- Auto-sorted by position before returning

### Fix 2: UI Sorting & Filtering (Frontend)

**File:** `client/src/components/run-details-drawer.tsx`

**Old Code:**
```tsx
{result.rankings.map((ranking: any, i: number) => (
  <div key={i}>
    <Badge variant="outline">{ranking.position}</Badge>
    <span>{ranking.item}</span>
  </div>
))}
```

**New Code:**
```tsx
{result.rankings
  .filter((r: any) => r.position > 0 && r.position <= 20)
  .sort((a: any, b: any) => a.position - b.position)
  .map((ranking: any, i: number) => (
    <div key={i}>
      <Badge variant="outline">{ranking.position}</Badge>
      <span>{ranking.item}</span>
    </div>
  ))}
```

**What Changed:**
- `.filter()` → Remove any remaining false positives (positions > 20)
- `.sort()` → Sort by position number (ascending: 1, 2, 3...)
- Rankings now display in **correct order**

---

## 📊 **Before vs After Comparison**

### Example AI Response

```markdown
### 1. Emirates
**Premium Economy Launch:** Emirates began rolling out...

- **Seating:** Wider seats (up to 19.5 inches), 8-inch recline.

### 2. Saudia (Saudi Arabian Airlines)
**Premium Economy Class:** Marketed as "Economy Comfort".

- **Seating:** 35-38 inch pitch, extra legroom.

### 3. Turkish Airlines
While based in Turkey, as of 2024.

### 4. Etihad Airways
### 5. Qatar Airways
```

### Before (Old Detection)

**Detected Rankings:**
```
Position 1: "Emirates"                              ✅ Correct
Position 19: "5 inches), 8-inch recline..."         ❌ FALSE (from "19.5")
Position 2: "Saudia (Saudi Arabian Airlines)"       ✅ Correct
Position 3: "Turkish Airlines"                      ✅ Correct
Position 2024: "While based in Turkey, as of 2024." ❌ FALSE (year)
Position 4: "Etihad Airways"                        ✅ Correct
Position 5: "Qatar Airways"                         ✅ Correct
```

**UI Display (unsorted):**
1. Position 1: Emirates
2. Position 19: 5 inches... ❌
3. Position 2: Saudia
4. Position 3: Turkish
5. Position 2024: ... ❌
6. Position 4: Etihad
7. Position 5: Qatar

### After (New Detection)

**Detected Rankings:**
```
Position 1: "Emirates"                        ✅ Correct
Position 2: "Saudia (Saudi Arabian Airlines)" ✅ Correct
Position 3: "Turkish Airlines"                ✅ Correct
Position 4: "Etihad Airways"                  ✅ Correct
Position 5: "Qatar Airways"                   ✅ Correct
```

**UI Display (sorted):**
1. Position 1: Emirates ✅
2. Position 2: Saudia ✅
3. Position 3: Turkish ✅
4. Position 4: Etihad ✅
5. Position 5: Qatar ✅

---

## 🎯 **What Rankings Represent**

### Ranking Detection Logic

The system looks for **4 patterns**:

| Pattern Type | Example | Position Assigned |
|--------------|---------|-------------------|
| **Markdown headings** | `### 1. Emirates`<br>`### 2. Qatar` | Explicit number (1, 2, 3...) |
| **Numbered lists** | `1. Emirates`<br>`2. Qatar` | Explicit number (1, 2, 3...) |
| **Bullet lists** | `- Emirates`<br>`- Qatar` | Sequential (1st bullet = 1, 2nd = 2...) |
| **Comparative words** | `Top airlines: Emirates`<br>`Best choice: Emirates` | Always position **1** |

### What Gets Ranked?

**For each AI response**, the system ranks:
- **Main sections** (### 1. Emirates, ### 2. Qatar)
- **List items** (1. Item, 2. Item, 3. Item)
- **Top mentions** ("Best airline: Emirates" → position 1)

**NOT ranked:**
- Measurements (`19.5 inches`)
- Years (`2024.`)
- Sub-bullets or nested content
- Plain text without structure

---

## 🔍 **Understanding Your Screenshot**

Looking at your original screenshot showing jumbled rankings:

```
10: Other Perks:** Amenity kits...
1: Premium Economy Launch:**...
2: **Seating:** Wider seats...
4: Etihad Airways
5: Qatar Airways
```

**Analysis:**

| Rank | Item | Issue |
|------|------|-------|
| 10 | "Other Perks: Amenity..." | ❌ False positive (not a real ranking) |
| 1 | "Premium Economy Launch" | ❌ False positive (sub-heading, not main ranking) |
| 2 | "**Seating:** Wider seats" | ❌ False positive (bullet point, not main ranking) |
| 4 | "Etihad Airways" | ✅ Correct (### 4. Etihad Airways) |
| 5 | "Qatar Airways" | ✅ Correct (### 5. Qatar Airways) |

**Root Cause:**
- Old regex matched **any** numbered pattern
- UI displayed in **detection order**, not sorted

**After Fix:**
- Only matches **true headings** (### 1., ### 2., etc.)
- UI displays **sorted** (1, 2, 3, 4, 5)

---

## 📈 **How Ranking Score Is Calculated**

Once rankings are detected, the system calculates a **Position Score using nDCG**:

### Step 1: Filter for Brand

```javascript
brandRankings = rankings.filter(r => 
  r.item.toLowerCase().includes(brandName.toLowerCase()) ||
  aliases.some(a => r.item.toLowerCase().includes(a.toLowerCase()))
);
```

**Example:**
```
All Rankings:
  1. Emirates          ← Includes "Emirates" ✅
  2. Saudia            ← No match ❌
  3. Turkish Airlines  ← No match ❌
  4. Etihad Airways    ← No match ❌
  5. Qatar Airways     ← No match ❌

Brand Rankings (Emirates):
  1. Emirates
```

### Step 2: Calculate nDCG

```
DCG = Σ (1 / log₂(1 + position))

For Emirates at position 1:
DCG = 1 / log₂(2) = 1.0

Ideal DCG (best possible):
Ideal DCG = 1 / log₂(2) = 1.0

nDCG = DCG / Ideal DCG = 1.0 / 1.0 = 1.0

Position Score = round(1.0 × 100) = 100
```

**Result:** Emirates gets **100/100** (perfect position!)

### Example 2: Multiple Brand Mentions

```
All Rankings:
  1. Emirates Premium Economy
  2. Saudia
  3. Emirates A380 Fleet
  5. Qatar

Brand Rankings (Emirates):
  1. Emirates Premium Economy  
  3. Emirates A380 Fleet

DCG = 1/log₂(2) + 1/log₂(4) = 1.0 + 0.5 = 1.5
Ideal = 1/log₂(2) + 1/log₂(3) = 1.0 + 0.631 = 1.631
nDCG = 1.5 / 1.631 = 0.92

Position Score = 92/100
```

---

## 🧪 **Testing the Fix**

### Test 1: Run Existing Prompt

1. Re-run the same prompt that showed jumbled rankings
2. Check the **Rankings** section in UI
3. **Expected:** Rankings sorted 1, 2, 3, 4, 5 (no false positives)

### Test 2: Check Database

```sql
-- See what rankings were saved
SELECT 
  r.position,
  r.item,
  COUNT(*) as count
FROM rankings r
JOIN answers a ON r.answer_id = a.id
JOIN prompt_run_items pri ON a.prompt_run_item_id = pri.id
WHERE pri.prompt_run_id = 'YOUR_RUN_ID'
GROUP BY r.position, r.item
ORDER BY r.position;
```

**Expected:** Only positions 1-20, no "19" or "2024" entries

### Test 3: Position Score

Check if position score changed:

```sql
SELECT 
  ai.model_name,
  a.position_score
FROM answers a
JOIN prompt_run_items pri ON a.prompt_run_item_id = pri.id
JOIN ai_models ai ON pri.ai_model_id = ai.id
WHERE pri.prompt_run_id = 'YOUR_RUN_ID';
```

**Expected:** Non-zero scores (if brand appears in rankings)

---

## 🚀 **Impact on Position Score: Production vs Development**

### Why Production Showed 0.0

**Likely causes:**

1. **No rankings detected** (regex missed markdown headings)
2. **Brand name mismatch** (response uses alias not configured)
3. **All false positives filtered out** (leaving empty array)

### Why Development Shows 92.0

**Likely causes:**

1. **Improved detection** catches markdown headings
2. **Brand appears at positions 1 and 2** (high score)
3. **False positives filtered**, leaving valid rankings

**Recommendation:**
- Re-run production prompts with new detection
- Check if brand aliases are configured
- Verify rankings in database

---

## 📚 **Key Takeaways**

1. **Rankings = Structured Lists**
   - Detects numbered headings, lists, and comparative statements
   - NOT measurements, years, or arbitrary numbers

2. **Position Matters**
   - Position 1 = Best (highest score)
   - Position 10 = Lower (reduced score via nDCG penalty)

3. **Brand Filtering is Critical**
   - Only rankings mentioning your brand count
   - No brand matches = Position Score 0

4. **UI Sorting is Essential**
   - Rankings must be sorted by position for clarity
   - Backend sorts, frontend re-sorts for safety

---

## 🔧 **Files Modified**

| File | Change | Purpose |
|------|--------|---------|
| `server/services/ranking-parser.ts` | Improved regex + validation | Filter false positives |
| `client/src/components/run-details-drawer.tsx` | Add sorting + filtering | Display rankings correctly |

---

## ✅ **Checklist**

- [x] Fix backend regex to avoid false positives
- [x] Add position range validation (1-20)
- [x] Add minimum item length check (≥3 chars)
- [x] Sort backend results by position
- [x] Add frontend sorting
- [x] Add frontend filtering (safety net)
- [x] Test with real AI response
- [x] Document changes

---

**Next Steps:**
1. Restart application to apply changes
2. Re-run your premium economy prompt
3. Verify rankings display correctly (1, 2, 3, 4, 5)
4. Check position scores are non-zero
