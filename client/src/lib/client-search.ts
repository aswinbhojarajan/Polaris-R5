import type { Client } from "@shared/schema";

export function clientMatchesQuery(client: Client, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const fields: string[] = [];
  if (client.projectName) fields.push(client.projectName);
  if (client.name) fields.push(client.name);
  if (client.industry) fields.push(client.industry);
  if (client.customIndustry) fields.push(client.customIndustry);
  if (client.geography) fields.push(String(client.geography));
  if (client.customGeography) fields.push(client.customGeography);
  if (Array.isArray(client.brandAliases)) {
    for (const a of client.brandAliases as unknown[]) {
      if (typeof a === "string") fields.push(a);
    }
  }
  if (Array.isArray(client.focusAreas)) {
    for (const f of client.focusAreas as unknown[]) {
      if (typeof f === "string") fields.push(f);
    }
  }

  for (const f of fields) {
    if (f.toLowerCase().includes(q)) return true;
  }
  return false;
}
