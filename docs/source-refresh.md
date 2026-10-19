# Refreshing saved sources

Prices, reference facts, discovery and recipes are independent jobs. Existing cloud schedules are reused; no duplicate schedule is required.

* The daily price service updates saved local catalog IDs only. Proshoper cards use category URLs with product anchors, so their shared category pages must still be downloaded and parsed. Unknown IDs are admitted by a separate discovery pass, weekly or from the Sources screen.
* Known nutrition sources are fetched by saved Magnit ID, Open Food Facts barcode, or an allowlisted HTTPS product URL. This path uses deterministic parsers and never calls search or Gemini. Firecrawl is a transport fallback for the exact saved page.
* Reference-store nutrition never supplies a Kogalym price or availability. Magnit's reference-store API may return 404 for a product still present on the public product page; the saved public page must be checked before treating the source as deleted.
* Sources with no deterministic local-price adapter report that limitation. Arbitrary-page extraction remains available in explicit discovery, instead of invoking model extraction during routine price refresh.
* Successful source checks are due again after seven days. Temporary failures retain the previous facts and retry after one hour. Missing or incompatible sources enter a separate repair/discovery queue, with its own retry deadline.
* The hourly maintenance service rotates through known-source checks, catalog discovery, nutrition discovery and recipe generation. It persists the next stage before doing network work. Failed sources therefore cannot starve the other queues. Discovery errors back off for a day; a partial catalog pass retries after an hour and does not retire unseen cards.

`EnrichmentRecord.sourceRefresh` stores the binding, parser version, representation-specific ETag/Last-Modified validators, last attempt/success/change, next check, latest extracted facts and up to eight semantic changes. Timestamps and HTML text are excluded from the fact fingerprint. A parser version change forces a fresh parse without old validators. A source rebind resets validators and retains the change history with its original source links.

HTTP 304 is accepted only after sending a validator for that same representation. Fallback HTML/Firecrawl responses do not reuse validators belonging to a JSON endpoint. When validators are unavailable, extracted facts are compared locally. Conditional request semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Conditional_requests

Owner-confirmed facts are locked. They can be checked for source conflicts, but are never overwritten automatically. Excluded products are not polled. Exact before-I/O record snapshots protect concurrent reviews and source rebindings. Refresh bookkeeping does not prevent undoing an otherwise unchanged owner review. Independently sourced preparation evidence remains attached to the same verified product.

Owner-private service operations:

* `POST /api/refresh-service`: due known local prices, without discovery or recipe generation.
* `POST /api/catalog-service` with `operation: "discover"`: local catalog discovery.
* `POST /api/enrichment-service` with `operation: "refresh-known"`: known reference sources. Optional bounded `limit`, `keys` and `force` support targeted checks.
* `POST /api/enrichment-service` with `operation: "discover"`: unresolved products and replacement sources.
* `POST /api/enrichment-service` with `operation: "run"`: one fair maintenance stage.
* `POST /api/recipe-service` with `operation: "fill"`: independent recipe generation.

These service endpoints retain the existing owner-private dispatch boundary and reject browser Origin headers. Public snapshots include product provenance and tracking metadata, never provider credentials.
