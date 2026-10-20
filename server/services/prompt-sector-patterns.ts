// Task #89 — Sector-specific exemplar patterns injected into the
// realism-aware prompt generator. Match is loose: any project whose
// industry / customIndustry / focusAreas string contains one of the
// keywords for a sector picks up that sector's pattern hints.
//
// Kept as a small in-process constant (not a DB table) for v1 — the
// taxonomy is small, ships with the code, and changes rarely. A future
// follow-up can promote this to a per-tenant admin-editable map.

export interface SectorPattern {
  key: string;
  // Lowercase substrings that indicate the project belongs to this sector.
  matches: string[];
  // Short human-readable label used in the prompt to introduce examples.
  label: string;
  // 3–6 short pattern hints. Each is a *category of question*, not a
  // ready-made prompt — the model still produces the actual wording.
  hints: string[];
}

export const SECTOR_PATTERNS: SectorPattern[] = [
  {
    key: "grocery",
    matches: ["grocery", "supermarket", "groceries"],
    label: "Grocery",
    hints: [
      "meal planning under a budget",
      "holiday-meal fulfillment with pickup or delivery windows",
      "real-time inventory and substitution",
      "EBT / SNAP and loyalty-program eligibility",
      "store hours, departments, and pharmacy/floral counters",
    ],
  },
  {
    key: "supplements",
    matches: ["supplement", "vitamin", "nutraceutical", "wellness"],
    label: "Supplements",
    hints: [
      "stack-builder questions for a goal (sleep, energy, recovery)",
      "ingredient and allergen filters",
      "third-party testing and certification",
      "promotions, autoship, and bundle discounts",
      "delivery speed and refrigeration requirements",
    ],
  },
  {
    key: "beauty",
    matches: ["beauty", "cosmetic", "skincare", "makeup", "fragrance"],
    label: "Beauty",
    hints: [
      "gifting for a person/occasion within a budget",
      "shade or skin-tone matching",
      "sustainability, refillable, or vegan filters",
      "return policy and try-before-you-buy",
      "financing, loyalty rewards, and birthday perks",
    ],
  },
  {
    key: "pharmacy",
    matches: ["pharmacy", "drugstore", "drug store"],
    label: "Pharmacy",
    hints: [
      "vaccine availability and walk-in eligibility",
      "OTC kit recommendations for a symptom",
      "prescription refill, sync, and transfer",
      "rapid test availability (flu, COVID, strep)",
      "after-hours and 24-hour locations",
    ],
  },
  {
    key: "department-store",
    matches: ["department store", "retailer", "general merchandise"],
    label: "Department Store",
    hints: [
      "gifting curated by recipient/occasion/budget",
      "deals, coupons, and stackable promotions",
      "outfit builders or room-style suggestions",
      "ship-by cutoffs for holidays and events",
      "loyalty-tier perks and credit-card financing",
    ],
  },
];

export function findSectorPattern(
  industry: string | null | undefined,
  customIndustry: string | null | undefined,
  focusAreas: unknown,
): SectorPattern | null {
  const tokens: string[] = [];
  if (industry) tokens.push(industry.toLowerCase());
  if (customIndustry) tokens.push(customIndustry.toLowerCase());
  if (Array.isArray(focusAreas)) {
    for (const fa of focusAreas) {
      if (typeof fa === "string") tokens.push(fa.toLowerCase());
    }
  }
  const blob = tokens.join(" | ");
  for (const sector of SECTOR_PATTERNS) {
    if (sector.matches.some((m) => blob.includes(m))) return sector;
  }
  return null;
}
