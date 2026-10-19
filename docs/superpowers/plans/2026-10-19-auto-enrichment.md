# Automatic product enrichment implementation plan

**Goal:** Expand the real Kogalym catalogue into usable meal ingredients without entering barcodes.

**Architecture:** Persist a product-name fingerprint queue beside local listings. Search Open Food Facts by name, verify candidate details, then search manufacturer and retailer product pages through Firecrawl. Exact, complete matches generate product-specific food IDs; ambiguous results remain visible with an explanation. Price and availability always come from the Kogalym listing. Build cooking templates from the eligible ingredient registry and pass that same registry to Gemini.

**Tech stack:** Existing React/Vinext/Workers/D1; public OFF search and v3.6 details; existing Firecrawl API-key integration. No extra dependencies.

**Evidence:** `work/auto-enrichment-audit.md`, `work/auto-enrichment-research.md`, current repository ingestion and optimizer tests.

## Constraints

- Preserve private owner access, encrypted API keys, manual barcode lookup, manual price overrides and raw listings.
- Never infer a gram weight from litres or pieces; never substitute an internal store ID for a GTIN.
- Require complete explicit nutrition on 100 g as sold. Missing values are unknown, not zero.
- Never copy another city's price or infer physical shelf availability from a catalogue.
- Cache matches for 30 days, misses for 7 days; retry transient errors later. Bound each request and persist after each product.

## Work

1. Pure matching and normalization (`lib/product-enrichment.ts`, tests): verify brand/name/fat/quantity; reject conflicting variants; classify cooking roles and produce exact ingredient/offer pairs. Tests cover pack mismatches, units, non-food and ambiguous candidates.
2. Provider parsing and queue (`lib/enrichment-sources.ts`, `lib/enrichment.ts`, `lib/server/enrichment.ts`, tests): search by name, read exact data with evidence, respect rate limits, resume independent batches and reconcile cached matches against current local listing identity/availability.
3. Dynamic cooking (`lib/menu-recipes.ts`, tests): generate feasible combinations for new cooking roles, expose the registry to Gemini and validate returned food IDs. Ensure a newly enriched item appears in a computed meal.
4. API/UI: expose counts and rejection reasons, product source links, automatic batch control; keep manual barcode UI. Add bounded owner-private service import/export/run operations for initial verified data and scheduled continuation.
5. Run the complete test suite, typecheck, local API checks and browser flows; publish exact pushed source and build, enrich live catalogue, verify real menus and preserve audience.

## Decisions

- The existing source-helper checkout is already the selected hosted project; reuse it and let the helper own commit/push/package.
- The first version's 23-item whitelist and 15 recipes are the primary known bottlenecks, not absence of nutrition alone.
- Native Sites database row inspection refuses the large monolithic state; a bounded product-only service export avoids exposing settings, identity, keys or history.
- Sites plugin eligibility discovery is unavailable in this session. Do not invent connector declarations; use the existing server-side API-key provider and public OFF. The connected Firecrawl plugin remains available for research and initial verified enrichment.
