# Spatial blog: "Boolean 3D Modeling: What to do when your Boolean Operations Fail"

- Kind: vendor blog post.
  - Canonical: https://blog.spatial.com/what-to-do-when-your-3d-modeling-boolean-operations-fail. Local copy: tmp/research/spatial/blog.html.
  - Related Spatial material:
    - "Outcome Checking, Logging and Progress Reporting in 3D ACIS" (2015): https://blog.spatial.com/3d-acis/outcome-checking-logging-and-progress-reporting-3d-acis, on the `outcome` object and `checkOutcome`.
    - The ACIS API documentation for the incremental Boolean is behind the customer login at download.spatial.com. The cached tmp/research/spatial/incr.html is just the login page, so the API was not read.
    - Public ACIS R17 docs mirror: http://www.q-solid.com/ACIS_Docs_R17/online/ (covered by [acis-r17-user-guide-booleans-technical-article.md](acis-r17-user-guide-booleans-technical-article.md) and [acis-r17-checker-and-intersectors-articles.md](acis-r17-checker-and-intersectors-articles.md)).
- Authors/organization: Spatial Corp. (Dassault Systèmes), vendor of 3D ACIS Modeler and CGM. The byline is "ADMIN". Page schema: datePublished 2017-04-12, dateModified 2022-04-20.
- License: copyrighted marketing and technical content, no code. The workflow idea is generic and free to reuse.
- Status: commercial; the feature ships in ACIS. It is a short post with no data behind its one statistic.

## What it is

A short field note from a major kernel vendor on (a) why Booleans fail in practice and (b) the "incremental Boolean workflow": on failure, run a local *prepare* step and retry. The post contrasts this with global healing.

## How it works (everything the post states; DOCUMENTED unless marked)

- **Stated root cause:** "unclear design intent in the way the tool and blank (the input bodies) are combined". Errors often come from *earlier operations* or from small errors when translating (importing) data.
- **Failure causes as listed.** There are six items. The research brief listed five and paraphrased one.
  1. Short edges and sliver faces.
  2. Huge tolerant entities and collapsed features. The figure shows a tolerant vertex sphere enveloping a short edge; "Such scenarios are not resolvable in many cases."
  3. Improper intersections.
  4. Near-coincident entities. The API "cannot determine whether the two faces are actually coincident (no intersection to be computed) or not (an intersection must be computed)".
  5. Near-tangent interactions.
  6. Complicated intersections.
- **Principle:** Booleans "are precise operations that make no attempt to infer design intent in an imported model". Only the incremental workflow "is allowed to make assumptions".
- **Incremental Boolean workflow:**
  1. The Boolean fails and reports its *complexities*, i.e. the reasons it failed.
  2. The *prepare API* tries to resolve the recognized complexities on the tool and/or blank. Example: make two near-coincident faces exactly coincident.
  3. Retry the Boolean.
  4. Stop when any of these holds:
     - no complexity is reported (success);
     - the prepare API fails;
     - "successive Boolean operations returns the exact same set of complexities" (no-progress fixpoint).
  - It is independent of the Boolean type (unite, subtract, imprint) and of options (regularized, selective).
  - It is extensible: users can add routines and stopping criteria.
- **Statistic, exact wording:** "70% of failed Boolean operations successfully corrected by the incremental Boolean workflow, required only a single iteration of the prepare step."
  - This is 70% *of the corrected cases*. It says nothing about what fraction of failures get corrected at all.
  - Correction to the brief, which read it as "70% of failures are fixed in one iteration".
  - There is no dataset, no count and no method, so treat the number as HEARSAY-grade.
- **Healing versus incremental Boolean:**
  - Healing is global, proactive and on a single body.
  - The incremental Boolean is local, reactive, on two bodies in the context of the Boolean, and only triggered by a failure.
  - They are "completely separate functionalities".

## Robustness and guarantees

None stated. The prepare step deliberately *changes geometry* (snapping, merging); no bounds are published. Termination is guaranteed only by the three stopping rules. INFERRED: the no-progress rule detects a fixpoint, not oscillation between two complexity sets.

## Parallelism and performance

Nothing reported.

## Known failures, limitations, war stories

- The post itself admits tolerant-vertex-over-short-edge cases are "not resolvable in many cases".
- The root cause framing, "unclear design intent", concedes that a kernel alone cannot decide near-coincidence. Something upstream has to say what was meant.

## Relevance for wonky

- **Failure taxonomy for explicit errors.** wonky already distinguishes `Unresolved` reasons (`NearParallelPlanes`, `NearCoincidentPlanes`, `NearTangency`, `LinearBudget`, …) from `Rejected` ones (docs/intersections.md). The ACIS list maps onto Boolean-level codes (INFERRED):

  | ACIS complexity | wonky code | Carries |
  | --- | --- | --- |
  | short edge / sliver face | `ShortEdge`, `SliverFace` | length or width versus tolerance |
  | huge tolerant entity / collapsed feature | `ToleranceExceedsFeature` | wonky has no tolerant entities, so this appears only on imported STEP |
  | improper intersection | `InvalidInput` / `SelfIntersectingInput` | |
  | near-coincident | `NearCoincidentFaces` | face pair plus separation |
  | near-tangent | `NearTangentFaces` | face pair plus angle |
  | complicated intersection | `UnsupportedSurfacePair` / `UnresolvedTopology` | |

  Every error should carry the involved entity IDs and the measured quantities, so a user or an LLM can act on it.
- **Where wonky stands today** (working tree, checked 2026-09-24):
  - The hybrid recover stage reports refusals as free-text strings, e.g. `CvNo{"plane/cone section is a hyperbola (curve type missing in the body format)"}` in `kernel/hybrid/recover/geom.bend`.
  - The same file makes its near-tangent and near-coincident decisions with hard-coded absolute thresholds, e.g.:
    - `1e-12` on 1 − |n·a| for "plane perpendicular to the cylinder axis";
    - `1e-9` on the cone slope for the parabola case;
    - `1e-10` on h² for a tangent circle.
  - Each of these thresholds is an ACIS-style "complexity" site. Give each one a typed code that carries the measured value and the threshold, so that a prepare-and-retry driver or an LLM can target it (INFERRED).
- **Prepare-and-retry, done wonky's way** (INFERRED):
  - Offer it as an *explicit, opt-in, logged* operation, never a silent fallback. Project rules require explicit tolerances and explicit failure.
  - Each prepare action must be recorded in provenance, with the geometric change and its bound. Example: "face F7 moved 0.8 µm to coincide with F12".
  - Bound the retries and use ACIS's fixpoint rule: stop if the complexity set repeats.
  - Also detect a 2-cycle, which ACIS's rule would miss.
- **Attack the root cause:**
  - In code-CAD the intent is often *known at construction time*: a face sketched on another face, a hole to depth "through all", a flush boss.
  - wonky can record exact coincidence symbolically, e.g. faces sharing the same plane object or a derived-from link. The Boolean then never has to guess from numbers.
  - This is Hoffmann's strategy 2, "trust the symbolic data" ([hoffmann-geometric-and-solid-modeling-1989-fundamental-techn.md](hoffmann-geometric-and-solid-modeling-1989-fundamental-techn.md)). It removes most near-coincidence failures before they happen.
- **LLM ergonomics:** a failure message such as "NearCoincidentFaces(F3 of Box#2, F9 of Plate#1), separation 3e-7 mm < tolerance 1e-6 mm; suggested fixes: make coincident (snap) or separate by ≥ 0.01 mm" is directly actionable by an LLM editing FeatureScript. Deliberate overlap is also common FDM practice for unions, e.g. 0.01-0.1 mm (INFERRED from general code-CAD practice, HEARSAY).
- **Testing:** the six causes are a checklist for the Boolean stress corpus (docs/boolean-stress.md). Build at least one fixture per cause and assert the typed error, or success after an explicit prepare.
- **Bend fit:** trivial. The retry driver is a small sequential loop around a pure Boolean function, and prepare steps are local pure rewrites.

## Pointers worth porting or studying

- The six-item failure list and the three stopping rules.
- The healing-versus-prepare distinction: global and proactive versus local, reactive and pairwise.
- The ACIS `outcome` pattern: every API call returns an object carrying error or warning info (2015 blog). This is the model for wonky's structured results.
- For how ACIS reports and checks errors in detail, see the R17 checker notes linked above.

## Verdict: learn-from

- There is no algorithm to port. The post contributes three things:
  - a vendor-validated failure taxonomy;
  - the local prepare-and-retry protocol with a no-progress stopping rule;
  - a framing of near-coincidence as a design-intent problem.
- wonky should adopt the taxonomy and structured failure records now. Offer prepare-and-retry only as an explicit, provenance-logged, opt-in operation. Prefer capturing coincidence intent symbolically at construction.
