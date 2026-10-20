export const INDUSTRIES = [
  "Accounting",
  "Advertising & Marketing",
  "Aerospace & Defense",
  "Agriculture",
  "Artificial Intelligence",
  "Automotive",
  "Banking",
  "Biotechnology",
  "Blockchain & Cryptocurrency",
  "Business Services",
  "Chemicals",
  "Construction",
  "Consulting",
  "Consumer Goods",
  "Cybersecurity",
  "E-commerce",
  "Education",
  "Energy & Utilities",
  "Engineering",
  "Entertainment & Media",
  "Environmental Services",
  "Financial Services",
  "Food & Beverage",
  "Gaming",
  "Government & Public Sector",
  "Healthcare",
  "Hospitality",
  "Human Resources",
  "Information Technology",
  "Insurance",
  "Legal",
  "Logistics & Transportation",
  "Manufacturing",
  "Non-Profit",
  "Pharmaceuticals",
  "Real Estate",
  "Retail",
  "SaaS & Software",
  "Sports & Fitness",
  "Telecommunications",
  "Tourism & Travel",
  "Other",
];

export const GEOGRAPHIES = [
  "Global",
  "Africa",
  "Asia",
  "Europe",
  "North America",
  "Oceania",
  "South America",
  "Central America",
  "Middle East",
  "Caribbean",
  "Southeast Asia",
  "Eastern Europe",
  "Western Europe",
  "Northern Europe",
  "Southern Europe",
  "East Asia",
  "South Asia",
  "Central Asia",
  "Sub-Saharan Africa",
  "North Africa",
  "Latin America",
  "Worldwide",
];

export function isCustomIndustry(value: string): boolean {
  return value.length > 0 && !INDUSTRIES.includes(value);
}

export function isCustomGeography(value: string): boolean {
  return value.length > 0 && !GEOGRAPHIES.includes(value);
}

export function normalizeCustomValue(value: string): string {
  return value.trim().slice(0, 100);
}
