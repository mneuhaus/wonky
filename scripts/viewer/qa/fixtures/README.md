# Viewer QA fixtures

Every `.fs` file in this directory is built by `node scripts/viewer/qa/fixtures.mjs`
into `tmp/viewer/fixtures/<name>.brep.json`, next to the example models and the
audit samples in `scripts/viewer/audit-data/`. Packages add their fixtures here
(for example pin-in-bore, a multi-body part, cross-bore-16).
