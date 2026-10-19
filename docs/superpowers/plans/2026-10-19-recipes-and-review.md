# Recipe automation and personal review implementation plan

**Goal:** Let every currently eligible grocery product enter recipe generation, retain validated Gemini recipes for later planning, and offer an evidence-based personal review game for unresolved products.

**Architecture:** A pure recipe registry separates catalogue coverage from the optimizer's bounded shortlist. A leased server worker reserves each Gemini call before generation, works on uncovered target foods with companion ingredients, validates identities and structured steps, and stores recipes with model/time/identity provenance. Review commands validate current task fingerprints and preserve factual evidence; rewards are idempotent and decisions reversible.

**Stack:** Existing React 19/Vinext, TypeScript, Sites private dispatch and D1 chunked state. No new client dependency or public audience change.

## Deliverables and checks

- [x] Pure recipe library and fair target queue; meaningful tests for products beyond position 120, cache identity changes, duplicate compositions and expired prices.
- [x] Optimizer considers request fit across the entire registry before selecting a bounded set; late feasible recipes and whole-package constraints tested.
- [x] Server generation reserves usage, respects daily limits and retries, validates structured ingredient references, persists valid siblings, and retains cached recipes on provider failure.
- [x] Automatic plan fill and existing background writer invoke the same worker. A private recipe service permits bounded owner operations and real generation verification without exporting keys.
- [x] Product review domain supports source-backed KBJU, literal edible mass, culinary type, skip/exclude/undo and once-per-product XP. Stale or incomplete submissions fail.
- [x] Mobile review card and recipe coverage panel use semantic forms, honest progress and accessible error/status feedback; no countdowns or pressure rewards.
- [x] Integrate shared registries/state/API, preserve local prices and manual barcode lookup, and invalidate recipes on product identity changes.
- [ ] Run unit/type/build checks and local API workflow, publish privately, verify actual Gemini generation and a menu using a newly covered product, save browser proof.

## Factual constraints

Gemini proposes recipes only. It never supplies stored prices, nutrition, package mass or local stock. All ingredients must be current known food IDs with usable offers. A schema-valid answer is still revalidated. Failure to produce a recipe remains visible and does not count as coverage. Price updates recalculate recipes; product identity/preparation changes invalidate them. Personal review requires explicit confirmation and a public source or stated label evidence. Unknown availability remains unknown.

Automatic generation starts enabled with an existing Gemini key and a bounded daily call allowance. Settings may pause generation or alter the allowance; already saved valid recipes remain usable without a new provider call. Existing hourly and daily updates continue to own scheduling.
