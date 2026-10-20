/**
 * Generates a typed OpenAPI client for the React frontend.
 *
 * The script imports the live `buildOpenApiDocument()` factory from
 * `server/routes/openapi.ts` (the same one that backs `GET /openapi.json`)
 * and feeds it through `openapi-typescript` to emit a fully typed
 * `paths` / `components` declaration into `shared/api-types.ts`.
 *
 * Run with:
 *   npx tsx scripts/generate-api-types.ts
 *
 * Re-run after any change to `server/routes/openapi.ts` (or the Zod
 * schemas it references) so the frontend client stays in sync with the
 * backend.
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";

import { buildOpenApiDocument } from "../server/routes/openapi";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "shared", "api-types.ts");

async function main() {
  // `buildOpenApiDocument()` returns the `OpenAPIObject` shape from
  // `openapi3-ts/oas30`. That's structurally a superset of openapi-typescript's
  // own `OpenAPI3` type (different package, same JSON schema), so we round-trip
  // through JSON to get a plain object the bundler is happy to consume.
  const document = JSON.parse(
    JSON.stringify(buildOpenApiDocument()),
  ) as OpenAPI3;

  const ast = await openapiTS(document, {
    alphabetize: true,
    immutableTypes: false,
  });

  const banner = [
    "/**",
    " * AUTO-GENERATED — do not edit by hand.",
    " *",
    " * Regenerate with:",
    " *   npx tsx scripts/generate-api-types.ts",
    " *",
    " * Source: server/routes/openapi.ts (`buildOpenApiDocument()`).",
    " */",
    "/* eslint-disable */",
    "",
  ].join("\n");

  const contents = banner + astToString(ast) + "\n";
  writeFileSync(OUT_PATH, contents, "utf8");

  console.log(
    `Wrote ${contents.length.toLocaleString()} bytes to ${OUT_PATH}`,
  );
}

main().catch((err) => {
  console.error("Failed to generate API types:", err);
  process.exit(1);
});
