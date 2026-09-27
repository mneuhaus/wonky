# Law inventory: what Bend laws can guarantee in the wonky kernel

Status: 2026-09-22, Bend 2.0.25, all 61 modules under `kernel/*.bend` and `kernel/ports/*.bend`.
Machine-readable twin: [`out/laws/candidates.json`](../../out/laws/candidates.json).
This document proposes laws. It changes no production code, and it does not touch `LAWS.bend` or `PROOF.bend`.

## 1. Short answer

**Do we use laws today?** Barely. `LAWS.bend` states four laws: the coedge flip is an involution, translation keeps
the vertex count, and two truth-table facts about `boolean.selected`. `PROOF.bend` proves them, and `npm test`
gates on `bend PROOF.bend` (0.40 s with a warm cache). None of the four touches shell validity, exact arithmetic,
admission, identity or the wire format. Everything that actually keeps the kernel honest is checked at run time:
`validateSolid`/`validateAnalytic` in JS, and `S.edges_closed`, `CT.valid`, `H.valid` and `CV.audit` in Bend.
Tests and the OCCT/Manifold differential checks cover the rest.

**Does it make sense to use them for a low-bug core?** Yes, for a clearly bounded part of the kernel. The probes
in this inventory show that this part is cheap to prove. 101 candidate laws over 61 modules (17661 lines): **45 class A**, **41 class B**, **15 class C**. 4 already exist in LAWS.bend/PROOF.bend. The probes of this inventory checked 19 more in full and 7 in part (instances or one of several statements). The probe files hold 45 checked laws (including helper lemmas and instance sizes) and took 6.8 s of checker time in total at a load of about 13.

Laws can own:

1. **Control flow.** Every published body passed its gate, an `Unresolved` part rejects the whole result,
   admission is enforced by the return type, one truth table is shared by two encodings, and a parallel rewrite
   equals the fold it replaced.
2. **The combinatorics of constructors.** Edge pairing, loop closure, Euler-Poincare and counts. For fixed
   skeletons these are proven by pure computation while every coordinate stays an opaque variable (frustum, and
   revolve up to n = 32, checked). For all n they need a small U32 lemma library.
3. **Exact integer arithmetic.** Sign symmetries are cheap. Full correctness needs Word-level lemmas, or Nat digits.
4. **Identity.** Stability of origins under revision changes and transforms is cheap. Injectivity of the framing
   is harder.
5. **Wire codecs.** Round trips hold once the F32 leaf is encoded structurally.

Laws cannot own anything whose truth depends on the value of an F32. That covers face orientation relative to the
geometry, point classification, intersections, volumes, tolerance policy and the soundness of the float filter.
Base declares every F32 operation as a postulate, so the checker can carry F32 values around but cannot reason
about them. For each such claim, the catalogue names the run-time check or differential test that has to cover it
instead.

The bug history shows both kinds of defect:

- 8b21014 (revolve loops ordered by height, edges used twice in one direction) is purely combinatorial.
  TOP-10 now rules it out; instances up to n = 32 are already proven.
- 9467cfb (`supported()` was a predicate nothing called) is control flow. TOP-12, TOP-13 and TOP-27 cover it.
- 1d73cd1 (a hole a metre outside the plate was admitted) is geometric. No law helps here. What catches it is a
  run-time volume cross-check (GEO-05) and the differential tests.
- 08463e5 (a doubled edge use caused by the orientation key) is mixed. Its skeleton is provable (TOP-16); the
  orientation bits are geometric (GEO-04).

So laws are worth it as the **second** safety net under a kernel that AI agents keep rewriting. They freeze the
discrete contracts that agents tend to break during refactors: gates, fuel adequacy, index bookkeeping and truth
tables. Run-time audits and differential tests stay responsible for geometry.

## 2. What a Bend law can see in this kernel

These findings come from `.tools/bend-2.0.25/bend2/base.bend`, from the guide, and from the probe files in
`tmp/laws/inventory/` (section 3).

1. **F32 is opaque.** Base declares `F32.add`, `F32.mul`, `F32.is_lt`, `F32.is_eq`, `F32.bits` and the others as
   `law`s without a `def`: they are primitives the runtime implements. No claim that depends on an F32 value can
   be proven. `R.equal` and `R.less` have no provable algebra, not even reflexivity (at run time
   `F32.is_eq(NaN, NaN)` is false anyway).
2. **Data that only carries F32 is fine.** Structural claims hold for all geometry: lengths, indices, orientation
   bits, constructor shapes. They are proven with the F32 fields as opaque variables: TOP-03 (transform keeps
   every coedge), TOP-05 (extrude has 2n vertices), TOP-08 (every frustum is a paired, vertex-manifold shell).
   A false claim of this kind is still rejected (`negative2.bend`: a refusal that depends on opaque F32 decisions
   does not reduce).
3. **Branches on F32 comparisons need Bool generalization.** Bend matches only on parameters, so a lemma quantifies
   over the `Bool` that a comparison produced. The law then holds whichever way the comparison went (insertion
   sorts, `perpendicular()` in pierce, the planar selection). Laws whose *truth* depends on the direction of a
   comparison are class C.
4. **U32 has a real definition.** `type U32 is Data: U32{data: Word(32n)}` is a 32-bit Bool vector, and Base proves
   `U32.add_comm`. Computation on U32 literals reduces in the checker: `from_nat`, `+ 1` and `is_eq` inside the
   revolve skeleton check in 0.30 s for n = 3. Lemmas over all words are provable by Word induction:
   `word_cmp_refl` plus `u32_eq_refl` take under 30 lines and check in 0.07 s. Base does not have add
   associativity, the U32/Nat bridges (`to_nat(from_nat(n)) = n` below 2^32,
   `from_nat(a + b) = from_nat(a) + from_nat(b)`) or bounds for `and`/`shrn`. That library decides what class B costs.
5. **Computation proofs need constructor-form arguments.** `Ring{radius, _} = ring` on an opaque `ring` blocks
   reduction. Quantify over the fields instead (`Rv.Ring{ra, ha}`). The first revolve instance failed until this
   change.
6. **Proof mechanics.** `%e : P` replaces the marked right-hand side of `e` with its left-hand side; `Equal.sym`
   rewrites in the other direction. A pattern variable that appears in a rewrite motive counts as consumed, so
   match first and rewrite after. Matches must follow binder order, so the parameter you induct on comes first
   (`take_drop_append` needed `xs` before `n`), and a helper that reads a parameter twice needs `+`. None of this
   is hard, but each point cost one iteration in the probes.
7. **The checker is cheap at this scale.** Every probe checks in under 4 s at a load of about 13 on 18 cores.
   Instance proofs grow roughly quadratically with skeleton size (revolve: 0.30 / 0.57 / 1.27 / 3.72 s for
   n = 3 / 8 / 16 / 32), because `S.edges_closed` is O(edges x uses). The existing gate takes 0.40 s warm
   (check cache in `~/.bend/check.json`); cold times belong to the spike.
8. **Determinism comes for free.** Kernel functions are pure: no clock, no randomness, no hash iteration order, no
   host state. For identity, the questions worth a law are *stability* (which inputs a key does not depend on)
   and *injectivity*.
9. **Termination is enforced, but not adequacy.** The kernel has no `@unsafe`. Fuel-bounded loops are total, yet
   several return a truncated result when their fuel runs out: `boolean.components` returns `Nil`,
   `truck-topology.components` returns `Nil`, and `planar-boolean-selection.select` classifies only the head cell
   at fuel 0. Each is adequate as called today. Fuel-adequacy laws (TOP-18, TOP-26, BOO-10) keep them that way.

**Classes used below.**

- **A:** discrete over ADTs and Nat. This includes structural claims over data that merely carries F32. Methods:
  case split, induction, Bool generalization, computation.
- **B:** needs facts about U32. *B-literal* claims only compute on literal U32 values; they are cheap and work
  today. *B-generic* claims quantify over all U32 values and need `Lib.u32`.
- **C:** floating-point geometry. Not provable. Each class-C entry names the run-time check or differential test
  that covers it instead.


## 3. Probe runs

All probes are standalone files under `tmp/laws/inventory/` (not part of the gate). One checker process at a time, `bend <file> --check-only`, Bend 2.0.25, times are wall clock.

| File | Laws | Result | Seconds | uptime | What it shows |
|---|---:|---|---:|---|---|
| `PROOF.bend` | 4 | All terms check | 0.4 | 21:35 load averages: 14.52 14.23 14.21 | existing gate, warm check cache (~/.bend/check.json) |
| `tmp/laws/inventory/smoke.bend` | 11 | All terms check | 0.26 | 21:41 load averages: 12.67 13.17 13.75 | TOP-03, TOP-05 (vertices), EXA-02, BOO-03, BOO-07, BOO-09 (left), BOO-16, IDN-02 + 2 lemmas |
| `tmp/laws/inventory/negative.bend` | 1 | rejected as expected (expected False, observed True) | 0.09 | 21:41 load averages: 13.02 13.23 13.77 | false truth-table law must fail |
| `tmp/laws/inventory/instances.bend` | 3 | All terms check | 0.3 | 21:42 load averages: 13.66 13.37 13.80 | TOP-08 frustum edges_closed + CT.valid, TOP-10 revolve n=3; first attempt failed until rings were given in constructor form |
| `tmp/laws/inventory/revolve8.bend` | 2 | All terms check | 0.57 | 21:42 load averages: 13.36 13.32 13.77 | TOP-10 n=8 edges_closed + CT.valid |
| `tmp/laws/inventory/revolve16.bend` | 2 | All terms check | 1.27 | 21:42 load averages: 13.49 13.35 13.78 | TOP-10 n=16 |
| `tmp/laws/inventory/revolve32.bend` | 2 | All terms check | 3.72 | 21:42 load averages: 13.69 13.39 13.79 | TOP-10 n=32 |
| `tmp/laws/inventory/u32-refl.bend` | 2 | All terms check | 0.07 | 21:43 load averages: 13.95 13.48 13.81 | EXA-19: forall a. U32.is_eq(a, a) by Word induction |
| `tmp/laws/inventory/smoke2.bend` | 13 | All terms check | 0.37 | 21:47 load averages: 12.97 13.27 13.63 | TOP-12, BOO-06, BOO-13, BOO-15, IDN-07, EXA-01, EXA-13, WIR-04 |
| `tmp/laws/inventory/smoke3.bend` | 10 | All terms check | 0.24 | 22:05 load averages: 13.29 13.38 13.14 | EXA-17, BOO-17, TOP-09, TOP-11 (n=4), TOP-17 (+ u32_eq_refl), BOO-11 (monotone), SRT-09; three failed attempts first (quantity, binder order) |
| `tmp/laws/inventory/negative2.bend` | 1 | rejected as expected | 0.18 | 21:47 load averages: 12.29 13.11 13.57 | a refusal that depends on opaque F32 decisions must not reduce |

**Related evidence from the parallel spike** (owned by another workflow; read, not reproduced here):
`kernel/laws/spike/` holds topology, exact-arithmetic, limb, order and wire lemma files with their own
`LAWS.bend`/`PROOF.bend`. `out/laws/spike-timings.jsonl` records, among others, extrude instances proven by evaluation
up to n = 64 (12.7 s) and an exhaustive U32 limb-split check below 8192 (5.8 s). `out/laws/spike-mutants.json`
records 10 of 10 injected defects caught by laws (for example a ring successor that wraps one step late, a
subtraction that forgets to negate, and a decoder that accepts trailing words). For class-B cost the spike's
numbers take precedence over the estimates in this inventory.

## 4. Module map

Types: N = Nat (fuel, counts), U = U32 (indices, codes, words), F = raw F32, R = R.Real (F32x2), S = String, ADT = result/sum types. "Mix" is the class split of the module's law surface.

| Module | Lines | Computes | Types | Invariants it relies on or should guarantee | Candidates | Mix |
|---|---:|---|---|---|---|---|
| `geometry.bend` | 93 | F32 Vec3 algebra, frames, lift/translate/rotate of point lists, polygon area vector | F, ADT | coordinates in mm; normalize() needs a nonzero vector (caller); translate/transform keep list length | TOP-01b, GEO-02 | A (shape) / C (values) |
| `precise.bend` | 67 | R.Real (F32x2) Vec3 algebra, frames, rotations | R, ADT | same as geometry at double-word precision | GEO-02 | C |
| `real.bend` | 155 | double-word arithmetic (two-sum, Dekker split, renorm), div, sqrt, atan/sin/cos series with Nat fuel | F, N | normalized pairs (\|lo\| <= ulp(hi)/2); no host floating point; series length fixed by fuel (18/20 terms) | EXA-16 | C |
| `topology.bend` | 103 | polyhedral B-rep types over U32 indices, coedge flip, polygon extrusion skeleton, rigid transform | U, N, F, ADT | extrude preconditions checked by the host (simple CCW polygon, >= 3 points); shared edge table; each edge used once per direction; loops closed; V - E + F = 2; transform keeps topology | TOP-01, TOP-02, TOP-03, TOP-05, TOP-06, TOP-07, SRT-08, GEO-03 | A/B |
| `analytic.bend` | 398 | analytic curves/surfaces, B-rep with inner loops, transforms, residuals, explicit periodic seams, frustum, bounds | R, U, ADT | seam used twice, opposite directions; curve sense independent of coedge direction; frustum preconditions (distinct centres, r > 0, x perpendicular); edge_at/vertex_at return a default edge/point for a bad index (fragile) | TOP-04, TOP-08, TOP-09, TOP-17, GEO-02, GEO-07 | A/B/C |
| `boolean.bend` | 375 | coaxial cylinder Booleans: 1-D interval arrangement (<= 3x2 cells), flood-fill components (fuel 6), revolved boundary, compaction, volume, bounds | R, U, N, ADT | op codes 0 union / 1 intersection / else difference; <= 6 cells, so 6 passes suffice; enclosed void refused; tiny material intervals rejected; index_of returns sentinel 4294967295 on a miss | BOO-01, BOO-02, BOO-03, BOO-05, BOO-18, TOP-18, TOP-19, TOP-20, TOP-25, SRT-03 | A/B (combinatorics) / C (geometry) |
| `boundary.bend` | 187 | stitch directed uses into closed rings by explicit vertex identity; degree checks; fuel-bounded walk | U, N, ADT | in-degree = out-degree = 1 per vertex; rings closed and all uses consumed; no distances, no welding; fuel exhaustion is an explicit WalkLimit | TOP-23 | B |
| `comparison.bend` | 42 | coaxial cylinder comparison: relation code 0-3, volumes, clearance | R, U, ADT | relation codes; not a general distance | GEO-05 | C |
| `curve-band.bend` | 346 | whole-domain distance bounds of a curve to a plane band; extremum candidates; exact-zero certificates | R, ADT | ExactCurveInPlane only with ExactZeroCoefficients; contact cap never enlarged; Unresolved is not a pass | BOO-17 | A (certificate discipline) / C |
| `curve-plane.bend` | 582 | line/circle/ellipse against a supporting plane; parameter domains and periodic lift; exact coefficient certificates; hit ordering | R, F (expansions), U, ADT | native parameters preserved; ambiguous -> Unresolved; hits ordered by parameter; certificates never prove nonzero | EXA-17, GEO-08 | C (A for flags) |
| `cylinder-classification.bend` | 458 | point membership in a trimmed cylinder face by meridian parity | R, U, ADT | opposite seam uses cancel; near cases unresolved; count joins AND their valid flags | BOO-19 | C (A for flag absorption) |
| `display.bend` | 49 | cylinder chart evaluation for viewer meshes only | R | never used for modeling | - | C (no law needed) |
| `edge-plane.bend` | 444 | finite B-rep edge against a plane, endpoint/seam classification | R, U, ADT | allowances validate incidence, never certify coincidence; join_selected ANDs validity | GEO-08 | C (A for joins) |
| `face-bounds.bend` | 125 | conservative directional bounds of prepared faces; exclusion filter | R, ADT | UnknownBounds absorbs in join; EmptyBounds is the join identity; bounds are conservative | BOO-16, GEO-07 | A / C |
| `face-classification.bend` | 647 | point membership in planar trimmed faces with analytic edges; multi-ray agreement; loop preparation | R, U, N, ADT | prepared loops closed; all resolved rays must agree, otherwise Unresolved; ambiguous crossings never forced into parity | BOO-19 | C (A/B for bookkeeping) |
| `face-plane.bend` | 695 | face/plane sections: boundary events sorted per support, span parity, section intervals | R, U, ADT | events sorted by parameter per support; odd event counts -> Unresolved (OddEvents); unique support mapping | SRT-01, SRT-05, GEO-08 | A (sorting shape) / C |
| `halfspace.bend` | 756 | convex planar solid against a halfspace: side classes, polygon clipping, cap stitching, compaction, H.valid gate | R, U, N, ADT | H.valid: nonempty, V + F = E + 2, edges_closed, all vertices used, connected, unique vertices/edges, positive volume; published solid = canonical(validated solid); mapped() returns 4294967295 on a miss; point(None) = (0,0,0) | TOP-24, TOP-28, TOP-30, BOO-14 | B (topology) / C (geometry) |
| `identity.bend` | 216 | topological naming: framed string keys, lineage for primitives, transforms and Boolean results | S, U, N, ADT | framing injective; semantic/source origins independent of revision; transforms keep origin; identity arrays align with B-rep arrays | IDN-01, IDN-02, IDN-03, IDN-05, IDN-06, IDN-07, IDN-09, IDN-10, IDN-11 | A (B for U32.show) |
| `intersections.bend` | 523 | supporting-surface intersections (plane/plane, plane/cylinder), tolerance validation, error-free expansions, exact-zero certificates | R, F (expansions), ADT | an unsafe expansion never certifies zero; guards are operational, not interval proofs | EXA-17, GEO-08 | A (flags) / C |
| `junction.bend` | 683 | associates retained points (vertices, samples, projections, intersections) into junction events with witnesses | R, U, ADT | never replaces a point or rewrites a curve; duplicate keys/anchors rejected; tolerance never promoted to coincidence | GEO-08 | B (key dedup) / C |
| `pierce.bend` | 475 | round through hole in a planar body: 8 decline codes, bore construction, removed volume | R, U, ADT | Bored only after admission (return type); hole loops only on the two pierced faces; entry circle forward, exit backward; in material, opposed faces, tool reaches through | TOP-14, TOP-15, TOP-16, BOO-20, GEO-04, GEO-05 | A/B skeleton / C admission |
| `ray.bend` | 328 | infinite line against plane/cylinder/cone roots with certificates; kinds 0-6 | R, F (expansions), U, ADT | roots ordered; certified double roots unsafe for parity; cone nappe filtering | EXA-17, GEO-08 | C |
| `revolve.bend` | 246 | closed polygonal profile revolved a full turn into planes/cylinders/cones; refusal codes 1-4; Pappus volume | R, U, ADT | >= 3 points, radii > 0, segments > tolerance, counterclockwise; circle i = edge i, seam j = count + j used twice by band j; genus 1 (solid torus); Swept only after admission | TOP-10, TOP-11, TOP-12, TOP-13, GEO-05, GEO-10 | A/B / C |
| `robust-predicates.bend` | 283 | filtered exact point/plane sign and implicit line/plane predicate over signed base-4096 integers | U (digits, words), F, ADT | canonical Big: digits < 4096, no top zero digit, no negative zero; nonfinite -> Undefined/Invalid; zero denominator -> Undefined; filter conservative | EXA-01, EXA-02, EXA-03, EXA-04, EXA-05, EXA-06, EXA-07, EXA-08, EXA-09, EXA-10, EXA-11, EXA-12, EXA-13, EXA-14, EXA-15 | A/B (integers) / C (filter, decoding) |
| `section.bend` | 459 | complete directed solid/plane section contours: roots keyed by (edge, word-identical parameter), oriented pieces, stitched rings | R, U, ADT | root identity = word identity (signed zeros kept); balanced root incidence; rings closed (via boundary.stitch) | SRT-11, EXA-18, TOP-23 | B / C |
| `sketch-arcs-intersections.bend` | 145 | analytic line/arc pair tests for sketch profiles | R, ADT | exclusion bounds never widen join allowances | GEO-08 | C |
| `sketch-arcs.bend` | 606 | line/arc sketch profiles: fits, degrees, walk, area; extrusion into analytic solids | R, U, N, ADT | unique ids; degree 2 per endpoint; single region; carrier circles not moved | SRT-08, GEO-04 | B (walk) / C |
| `sketch-lines.bend` | 487 | line-segment sketch profiles by exact source-word identity: degrees, walk, quantization, area/orientation | U (source words), R, N, ADT | identity by binary64 source words (+0 = -0); degree exactly 2; no self-intersection; single region | SKL-01, SRT-08 | B / C |
| `solid-classification.bend` | 283 | even/odd point-in-solid over trimmed faces with 5-ray voting; edges_closed topology check | R, U, ADT | edges_closed precondition; all faces visited; rays must agree (>= 2, no conflict) | TOP-21, BOO-11, BOO-19 | B / C |
| `step-cylinder-pcurves-geometry.bend` | 283 | export-only cylinder pcurve spline construction and checks | R, U, N, ADT | checked against untouched input, never written back | - | C (A for knot counts) |
| `step-cylinder-pcurves.bend` | 359 | plans pcurves for every cylindrical face; edge-to-pcurve associations (ordinary / seam) | R, U, ADT | every edge has exactly two pcurve associations (a seam: same face twice) | - | B (association counts) / C |
| `step-pcurves.bend` | 228 | export-only 2D pcurves (Hermite) with error bound | R, U, N, ADT | error <= amplitude * h^4 / 384; guard is operational | - | C |
| `tessellate.bend` | 79 | chord count for a print-mesh deviation; ring sample points | R, U, N | count in [3, 8192]; one count per body (host); within() verified (host re-check) | TES-01, GEO-06 | B / C |
| `ports/types.bend` | 45 | common port contract types (Reason, origins, Component, Result) | U, ADT | Unresolved carries no bodies (by type) | - | by construction |
| `ports/planar-boolean-types.bend` | 32 | planar Boolean result, provenance and stats types | U, R, ADT | face_equal is an equivalence | BOO-15 | B |
| `ports/planar-boolean.bend` | 217 | planar union/subtraction driver: admission, arrangement, selection, pairing, provenance, per-component audits | R, U, ADT | every published body audited (CV, V, CT); one Unresolved component rejects everything; cavities rejected | TOP-27, BOO-14, BOO-15 | A (control flow) |
| `ports/planar-boolean-selection.bend` | 170 | cell classification (parallel halving with fuel), polygon pairing (cyclic), interface removal | U, N, ADT | select = left fold (order, count, lowest failure); invalid membership -> Failed; interfaces paired exactly twice, opposite | BOO-06, BOO-07, BOO-09, BOO-10, SRT-09 | A/B |
| `ports/planar-boolean-arrangement.bend` | 241 | convex-cell plane arrangement with global vertex IDs; unique planes; centroids | R, U, ADT | global vertex IDs, no coordinate welding; plane dedup | SRT-08 | C (A for helpers) |
| `ports/planar-boolean-provenance.bend` | 273 | face/edge origin maps for planar results | R, U, ADT | one owner per output face; fallback FaceRef{MAX, MAX} (fragile) | TOP-25 | B / C |
| `ports/solid-intersection.bend` | 210 | convex-tool intersection sequences with composed provenance | R, U, ADT | a failed later plane discards the whole result; references composed, never reset | BOO-15 | A (control flow) / C |
| `ports/curved-intersection.bend` | 180 | convex-tool sequences with explicit contact policy | R, U, ADT | no partial result solids; policy chosen before the sequence, never escalated | BOO-15 | A / C |
| `ports/curved.bend` | 188 | transverse clip of planar/cylindrical solids; components (fuel); audits | R, U, N, ADT | fuel exhaustion -> invalid (explicit); each component audited | TOP-29 | A (gate) / C |
| `ports/curved-edges.bend` | 295 | shared analytic edge events and splits (paves sorted by parameter) | R, U, ADT | root identity by native edge + parameter; parallel lists aligned; mapped() sentinel on a miss | ALN-01, SRT-01, TOP-25 | A/B / C |
| `ports/curved-faces.bend` | 285 | rebuilds face regions and caps; hole ownership | R, U, ADT | unique owner per hole | - | B / C |
| `ports/curved-metrics.bend` | 187 | analytic boundary integrals (area, volume) | R, U, ADT | no sampled polygons | GEO-05 | C |
| `ports/curved-retention.bend` | 95 | whole-body retain/remove/undecided by conservative bounds | R, U, ADT | unknown bounds -> Undecided | BOO-16 | A / C |
| `ports/curved-validate.bend` | 154 | audit of curved solids: carrier errors, orientations, volume | R, U, ADT | audit Bool gates publication | GEO-04 | C (A as gate input) |
| `ports/curved-contact.bend` | 131 | contact-policy clip; parts (fuel); component audits | R, U, N, ADT | fuel exhaustion -> invalid; each part audited | TOP-29 | A / C |
| `ports/curved-contact-events.bend` | 271 | vertex/edge/face contact passes with exact decisions | R, U, ADT | independent sources never merged; valid flags AND through passes | - | A (flags) / C |
| `ports/curved-contact-faces.bend` | 445 | rebuild faces with contact; ownership; nesting rejection | R, U, ADT | same-oriented nesting rejected; every retained SourceEdge use has one equally directed use | - | B / C |
| `ports/curved-contact-state.bend` | 55 | policy and ledger types | R, U, ADT | ledger version stamped | - | by construction |
| `ports/curved-contact-topology.bend` | 106 | vertex-link manifold check (CT.valid) over edge ends | U, N, ADT | each vertex link is one cycle; periodic edges have two distinct ends | TOP-08, TOP-22 | B |
| `ports/hybrid.bend` | 171 | route selection (transverse planar / contact planar / cylindrical) plus extra BSP audit | R, U, ADT | Undefined contact -> InvalidRoute; audit only rejects; no fallback after Unresolved | BOO-13, BOO-14, TOP-29 | A |
| `ports/occt-edges.bend` | 127 | OCCT PaveBlock split-edge table for one plane | U, R, ADT | each source edge processed once; parallel lists aligned; block index points at the appended edge | ALN-01 | A/B |
| `ports/occt-planar.bend` | 127 | validation of the bounded planar subset (V.valid) | R, U, ADT | embedded oriented shell is a precondition, not checked globally | - | B / C |
| `ports/occt.bend` | 381 | OCCT-derived clip: split edges, BuilderFace wires, BuilderSolid components | R, U, N, ADT | holes rejected atomically; fuel exhaustion -> invalid; components audited | SRT-01, TOP-29 | A/B / C |
| `ports/solvespace-bsp.bend` | 123 | UV BSP classification used as an extra audit | R, U, N, ADT | conflicting boundary sides -> unknown; fuel exhaustion -> Bad | SRT-01 | A (sort shape) / C |
| `ports/solvespace.bend` | 594 | SolveSpace-derived clip: split edges, sorted cut events, intervals, compaction, genus-0 gate | R, U, ADT | unique split events; edge_index sentinel on a miss; genus-zero gate in U32 | SRT-01, SRT-06, TOP-25, TOP-29, TOP-30 | A/B / C |
| `ports/truck-cylinder.bend` | 366 | Truck-derived clip of one full cylindrical band with explicit seams | R, U, ADT | validated over whole curves, not samples | - | C |
| `ports/truck-topology.bend` | 637 | Truck-derived polyline rings, face division, connected components, compaction | R, U, N, ADT | immutable vertex identities, no welding; components partition faces (fuel); lookup sentinel on a miss | TOP-25, TOP-26, SRT-08 | A/B |
| `ports/truck.bend` | 350 | Truck transversal corefinement for planar solids: split edges, sorted line cuts, interval pairs | R, U, ADT | crossings alternate on a transverse line (pairs); odd crossing count -> invalid | SRT-01, TOP-29 | A / C |

## 5. Candidate catalogue

Module aliases used in the statements:

`G` = kernel/geometry.bend, `PG` = kernel/precise.bend, `R` = kernel/real.bend, `T` = kernel/topology.bend, `A` = kernel/analytic.bend, `B` = kernel/boolean.bend, `Bd` = kernel/boundary.bend, `RP` = kernel/robust-predicates.bend, `Id` = kernel/identity.bend, `S` = kernel/solid-classification.bend, `H` = kernel/halfspace.bend, `FB` = kernel/face-bounds.bend, `F` = kernel/face-classification.bend, `I` = kernel/intersections.bend, `E` = kernel/edge-plane.bend, `CB` = kernel/curve-band.bend, `Rv` = kernel/revolve.bend, `Pc` = kernel/pierce.bend, `Sec` = kernel/section.bend, `Ts` = kernel/tessellate.bend, `FP` = kernel/face-plane.bend, `SL` = kernel/sketch-lines.bend, `P` = kernel/ports/types.bend, `PT` = kernel/ports/planar-boolean-types.bend, `PB` = kernel/ports/planar-boolean.bend, `Q` = kernel/ports/planar-boolean-selection.bend, `D` = kernel/ports/planar-boolean-arrangement.bend, `Hy` = kernel/ports/hybrid.bend, `CT` = kernel/ports/curved-contact-topology.bend, `OE` = kernel/ports/occt-edges.bend, `Tt` = kernel/ports/truck-topology.bend, `Sv` = kernel/ports/solvespace.bend, `W` = generated wire.bend (output of scripts/native-bridge/gen-wire.mjs), `Spec` = reference helpers (human-owned when used in LAWS.bend claims, see PR-1), `Lib` = kernel/laws/lib/*.bend (proposed lemma library).

`Spec.*` helpers are small reference functions (counts, pairing, permutation, projections). They are specifications, not production code: the ones that appear in a claim of `LAWS.bend` must be owned by the human like `LAWS.bend` itself (see PR-1), while helpers used only inside proofs can live in `kernel/laws/spec.bend`. Where a statement uses the kernel's own checker (`S.edges_closed`, `CT.valid`) as the specification, TOP-21/TOP-22 are the laws that say what that checker means.

### 5.1 Topology well-formedness and gate coverage

| ID | Law | Class | Effort | Status | Prio |
|---|---|---|---|---|---:|
| TOP-01 | `coedge_flip_involution` | A | XS | existing | 3 |
| TOP-01b | `translation_preserves_vertex_count` | A | XS | existing | 3 |
| TOP-02 | `reverse_uses_involutive` | A | S | proposed | 2 |
| TOP-03 | `transform_keeps_topology` | A | XS | proven-in-probe | 1 |
| TOP-04 | `analytic_transform_keeps_topology` | A | S | proposed | 2 |
| TOP-05 | `extrude_counts` | A | S | partly-proven-in-probe | 1 |
| TOP-06 | `extrude_edges_paired` | B | M | proposed | 1 |
| TOP-07 | `extrude_loops_closed` | B | M | proposed | 2 |
| TOP-08 | `frustum_edges_closed_and_links` | B | XS | proven-in-probe | 1 |
| TOP-09 | `frustum_euler_poincare` | A | XS | proven-in-probe | 2 |
| TOP-10 | `revolve_shell_paired` | B | M | proven-in-probe (instances) | 1 |
| TOP-11 | `revolve_counts_genus_one` | A | S | proven-in-probe (instance n = 4) | 2 |
| TOP-12 | `revolve_refuses_short_profiles` | B | XS | proven-in-probe | 1 |
| TOP-13 | `revolve_swept_only_after_admission` | B | S | proposed | 2 |
| TOP-14 | `pierce_bored_only_after_admission` | B | S | proposed | 2 |
| TOP-15 | `pierce_counts` | B | M | proposed | 3 |
| TOP-16 | `pierce_skeleton_paired` | B | L | proposed | 3 |
| TOP-17 | `seam_used_once_each_way` | B | S | proven-in-probe | 3 |
| TOP-18 | `coaxial_components_keep_cells` | A | M | proposed | 2 |
| TOP-19 | `coaxial_flood_complete` | B | S | proposed | 3 |
| TOP-20 | `coaxial_boundary_paired` | B | M | proposed | 2 |
| TOP-21 | `edges_closed_means_paired` | B | M | proposed | 2 |
| TOP-22 | `vertex_links_are_cycles` | B | L | proposed | 3 |
| TOP-23 | `stitch_sound` | B | L | proposed | 2 |
| TOP-24 | `compact_remap_consistent` | B | L | proposed | 2 |
| TOP-25 | `remaps_never_hit_sentinel` | B | M | proposed | 2 |
| TOP-26 | `truck_components_keep_faces` | A | M | proposed | 3 |
| TOP-27 | `planar_boolean_result_gated` | A | M | proposed | 1 |
| TOP-28 | `halfspace_result_gated` | A | S | proposed | 2 |
| TOP-29 | `port_results_gated` | A | M | proposed | 2 |
| TOP-30 | `euler_gate_matches_nat` | B | M | proposed | 3 |
| ALN-01 | `edge_tables_stay_aligned` | A | S | proposed | 2 |

#### TOP-01 `coedge_flip_involution` (class A, effort XS)

Modules: `kernel/topology.bend`.

```python
law coedge_flip_involution:
  for +use: T.Coedge
  {T.flip(T.flip(use)) == use : T.Coedge}
```

- **Value:** Orientation reversal cannot lose or invent a direction bit.
- **Provability:** class A; case split.
- **Effort:** XS. Existing, proven in PROOF.bend.

#### TOP-01b `translation_preserves_vertex_count` (class A, effort XS)

Modules: `kernel/geometry.bend`.

```python
law translation_preserves_vertex_count:
  for +points: List<&2, G.Vec3>
  for +delta: G.Vec3
  {List.length(&2, G.Vec3, G.translate(points, delta)) == List.length(&2, G.Vec3, points) : Nat}
```

- **Value:** Shape of translate; building block for the extrude counts.
- **Provability:** class A; structural induction.
- **Effort:** XS. Existing, proven in PROOF.bend.

#### TOP-02 `reverse_uses_involutive` (class A, effort S)

Modules: `kernel/topology.bend`.

```python
law reverse_uses_involutive:
  for +uses: List<&2, T.Coedge>
  {T.reverse_uses(T.reverse_uses(uses, Nil{}), Nil{}) == uses : List<&2, T.Coedge>}
```

- **Value:** The extrude bottom cap is the reversed, flipped ring. A wrong reversal turns the cap inside out, which today only the host signed-area check in validateSolid catches.
- **Provability:** class A; accumulator lemma reverse_uses(xs, acc) = revflip(xs) ++ acc, plus TOP-01.
- **Effort:** S. Needs the generalized accumulator lemma and List.append associativity (Lib.list).

#### TOP-03 `transform_keeps_topology` (class A, effort XS)

Modules: `kernel/topology.bend`.

```python
law transform_keeps_edges:
  for +s: T.Solid
  for +r: G.Rotation
  for +o: G.Vec3
  {Spec.t_edges(T.transform(s, r, o)) == Spec.t_edges(s) : List<&2, T.Edge>}

law transform_keeps_boundaries:
  for +faces: List<&2, T.Face>
  for +r: G.Rotation
  for +o: G.Vec3
  {Spec.boundaries(T.transform_faces(faces, r, o)) == Spec.boundaries(faces) : List<&2, List<&2, T.Coedge>>}
```

- **Value:** Rigid transforms and patterns never re-index, drop or re-orient a coedge (topology.bend claims this in a comment). The winding half of that comment also needs det(R) = +1, see GEO-03.
- **Provability:** class A; structural induction; the F32 payload stays opaque.
- **Effort:** XS. Both laws proven in tmp/laws/inventory/smoke.bend (one rewrite).

#### TOP-04 `analytic_transform_keeps_topology` (class A, effort S)

Modules: `kernel/analytic.bend`.

```python
law analytic_transform_keeps_topology:
  for +s: A.Solid
  for +r: PG.Rotation
  for +o: PG.Vec3
  {Spec.a_skeleton(A.transform(s, r, o)) == Spec.a_skeleton(s) : Spec.Skeleton}
```

Helpers: Spec.a_skeleton(s) projects edges to (start, end, same_sense) and faces to (same_sense, loops).

- **Value:** TOP-03 for analytic bodies (patterns of bores, revolves, Boolean results): senses and loops survive a transform.
- **Provability:** class A; structural induction over edges and faces.
- **Effort:** S. Two list inductions like TOP-03 plus a Skeleton type in Spec.

#### TOP-05 `extrude_counts` (class A, effort S)

Modules: `kernel/topology.bend`.

```python
law extrude_vertex_count:
  for +points: List<&2, G.Vec3>
  for +delta: G.Vec3
  {List.length(&2, G.Vec3, Spec.t_vertices(T.extrude(points, delta))) == Nat.add(List.length(&2, G.Vec3, points), List.length(&2, G.Vec3, points)) : Nat}

law extrude_edge_count:
  for +points: List<&2, G.Vec3>
  for +delta: G.Vec3
  {List.length(&2, T.Edge, Spec.t_edges(T.extrude(points, delta))) == Nat.add(List.length(&2, G.Vec3, points), Nat.add(List.length(&2, G.Vec3, points), List.length(&2, G.Vec3, points))) : Nat}

law extrude_face_count:
  for +points: List<&2, G.Vec3>
  for +delta: G.Vec3
  {List.length(&2, T.Face, Spec.t_faces(T.extrude(points, delta))) == 2n+List.length(&2, G.Vec3, points) : Nat}
```

- **Value:** Pins V = 2n, E = 3n, F = n + 2, hence V - E + F = 2 for every profile length (the host checks Euler per body at run time only). Also the count contract identity.extrusion relies on (IDN-06).
- **Provability:** class A; length lemmas over append, ring_edges, vertical_edges, side_faces.
- **Effort:** S. The vertex count is proven in smoke.bend with two lemmas. Edges and faces need length(ring_edges(k, ..)) = k style lemmas, each XS.

#### TOP-06 `extrude_edges_paired` (class B, effort M)

Modules: `kernel/topology.bend`.

```python
# instance (generated for n = 3..32):
law extrude4_edges_paired:
  for +p0: G.Vec3
  for +p1: G.Vec3
  for +p2: G.Vec3
  for +p3: G.Vec3
  for +delta: G.Vec3
  {Spec.t_edges_paired(T.extrude([p0, p1, p2, p3], delta)) == True{} : Bool}

# generic form (needs the U32 index lemmas):
law extrude_edges_paired:
  for +points: List<&2, G.Vec3>
  for +delta: G.Vec3
  for h: {Nat.is_lt(2n, List.length(&2, G.Vec3, points)) == True{} : Bool}
  {Spec.t_edges_paired(T.extrude(points, delta)) == True{} : Bool}
```

Helpers: Spec.t_edges_paired: every edge index below |edges| is used exactly once forward and once backward across the T.Face boundaries (S.edges_closed transposed to T.Solid).

- **Value:** Closed, consistently oriented shell for every planar extrusion, the most common body in the kernel. Rules out index slips in ring_edges, next and side_face (e.g. 2*n+next(i,n) versus 2*n+i).
- **Provability:** class B; instances by computation (proof = {==}); generic n via Lib.u32 (add_one_is_inc, from_nat_add, from_nat injective below 2^32).
- **Effort:** M. Instances are XS each once Spec.t_edges_paired exists (the revolve analogue checks in 0.3-3.7 s). The generic law is M-L, dominated by U32 index arithmetic (next wrap, offsets n+i and 2n+i).

#### TOP-07 `extrude_loops_closed` (class B, effort M)

Modules: `kernel/topology.bend`.

```python
law extrude4_loops_closed:
  for +p0: G.Vec3
  for +p1: G.Vec3
  for +p2: G.Vec3
  for +p3: G.Vec3
  for +delta: G.Vec3
  {Spec.t_loops_closed(T.extrude([p0, p1, p2, p3], delta)) == True{} : Bool}
```

Helpers: Spec.t_loops_closed: in every face the end vertex of use i equals the start vertex of use i+1, cyclically (as in validateSolid).

- **Value:** Loop closure ("Face loop is not closed" in src/brep.mjs) becomes a theorem instead of a run-time failure.
- **Provability:** class B; instances by computation; generic form like TOP-06.
- **Effort:** M. Same structure as TOP-06; shares its lemma library.

#### TOP-08 `frustum_edges_closed_and_links` (class B, effort XS)

Modules: `kernel/analytic.bend`, `kernel/solid-classification.bend`, `kernel/ports/curved-contact-topology.bend`.

```python
law frustum_edges_closed:
  for +bottom: PG.Vec3
  for +top: PG.Vec3
  for +x: PG.Vec3
  for +r0: R.Real
  for +r1: R.Real
  {S.edges_closed(Spec.a_edges(A.frustum(bottom, top, x, r0, r1)), Spec.a_faces(A.frustum(bottom, top, x, r0, r1)), 0) == True{} : Bool}

law frustum_vertex_links:
  for +bottom: PG.Vec3
  for +top: PG.Vec3
  for +x: PG.Vec3
  for +r0: R.Real
  for +r1: R.Real
  {CT.valid(A.frustum(bottom, top, x, r0, r1)) == True{} : Bool}
```

- **Value:** Every cylinder, cone and frustum is a paired shell with manifold vertex links, for all geometry. The kernel's own gates serve as the specification.
- **Provability:** class B; computation on U32 literals (fixed skeleton); geometry stays opaque.
- **Effort:** XS. Proven in tmp/laws/inventory/instances.bend; the proof is {==}.

#### TOP-09 `frustum_euler_poincare` (class A, effort XS)

Modules: `kernel/analytic.bend`.

```python
law frustum_euler_poincare:
  for +bottom: PG.Vec3
  for +top: PG.Vec3
  for +x: PG.Vec3
  for +r0: R.Real
  for +r1: R.Real
  {Spec.euler_holds(A.frustum(bottom, top, x, r0, r1), 1n, 0n) == True{} : Bool}
```

Helpers: Spec.euler_holds(s, shells, genus) := Nat.is_eq(V + 2F + 2G, E + L + 2S), i.e. V - E + 2F - L - 2S + 2G = 0 rearranged for Nat.

- **Value:** Pins genus 0 for frusta. The same helper states genus 1 for revolve (TOP-11) and one more handle per bore (TOP-15). Today Euler-Poincare with inner loops is asserted only inside individual JS tests (pierce, revolve), never by a validator. Bugs: 08463e5 (pierce: inner-loop direction keyed on same_sense gave a doubled edge use on planar bodies; a blind tool cut a full through hole).
- **Provability:** class A; computation (all counts are literal list lengths).
- **Effort:** XS. Proven in smoke3.bend with a 10-line euler_holds helper; the proof is {==}.

#### TOP-10 `revolve_shell_paired` (class B, effort M)

Modules: `kernel/revolve.bend`.

```python
# instance (checked for n = 3, 8, 16, 32):
law revolve3_edges_closed:
  for +ra: R.Real
  for +ha: R.Real
  for +rb: R.Real
  for +hb: R.Real
  for +rc: R.Real
  for +hc: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {S.edges_closed(Spec.a_edges(Rv.shell([Rv.Ring{ra, ha}, Rv.Ring{rb, hb}, Rv.Ring{rc, hc}], o, axis, x)), Spec.a_faces(Rv.shell([Rv.Ring{ra, ha}, Rv.Ring{rb, hb}, Rv.Ring{rc, hc}], o, axis, x)), 0) == True{} : Bool}

# generic form:
law revolve_edges_closed:
  for +profile: List<&2, Rv.Ring>
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {S.edges_closed(Spec.a_edges(Rv.shell(profile, o, axis, x)), Spec.a_faces(Rv.shell(profile, o, axis, x)), 0) == True{} : Bool}
```

- **Value:** Exactly the defect class of 8b21014 (loops ordered by height gave a disconnected boundary, then edges used twice in one direction). Holds for every profile, clockwise ones included; orientation is a separate, geometric question (GEO-04, GEO-10). Bugs: 8b21014 (revolve: loops ordered by height gave a disconnected boundary, then edges used twice in one direction; the Pappus volume came out negated).
- **Provability:** class B; instances by computation (checked); generic n with Lib.u32 and a band-by-band induction.
- **Effort:** M. Instances check in 0.30 / 0.57 / 1.27 / 3.72 s for n = 3 / 8 / 16 / 32 (two laws each from n = 8). The generic law needs the count+j seam indices and the wrap of circle i to 0.

#### TOP-11 `revolve_counts_genus_one` (class A, effort S)

Modules: `kernel/revolve.bend`.

```python
law revolve_counts:
  for +profile: List<&2, Rv.Ring>
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {Spec.euler_holds(Rv.shell(profile, o, axis, x), 1n, 1n) == True{} : Bool}
```

- **Value:** A profile that does not touch the axis revolves into a solid torus (V = n, E = 2n, F = n, L = n, genus 1). Catches a lost or duplicated band or seam. Bugs: 8b21014 (revolve: loops ordered by height gave a disconnected boundary, then edges used twice in one direction; the Pappus volume came out negated).
- **Provability:** class A; length lemmas for circle_edges, seam_edges, bands, seam_points (each has length n).
- **Effort:** S. The n = 4 instance is proven in smoke3.bend by {==}. The generic law needs four parallel length inductions and Nat arithmetic; only lengths are counted, so no U32 reasoning.

#### TOP-12 `revolve_refuses_short_profiles` (class B, effort XS)

Modules: `kernel/revolve.bend`.

```python
law revolve_refuses_empty:
  for +t: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {Rv.revolve(Nil{}, t, o, axis, x) == Rv.Refused{1} : Rv.Revolved}

law revolve_refuses_two_points:
  for +ra: R.Real
  for +ha: R.Real
  for +rb: R.Real
  for +hb: R.Real
  for +t: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {Rv.revolve([Rv.Ring{ra, ha}, Rv.Ring{rb, hb}], t, o, axis, x) == Rv.Refused{1} : Rv.Revolved}
```

- **Value:** The two-point profile of 9467cfb (coincident planes that validated and exported) can never be built again, whatever happens to the geometric checks. Bugs: 9467cfb (revolve: supported() was a predicate nothing called; a 2-point profile built coincident planes that validated; clockwise profiles and ulp-thin segments were accepted).
- **Provability:** class B; computation (U32 literals; the later refusals stay unevaluated behind Bool.pick).
- **Effort:** XS. Proven in smoke2.bend for 0 and 2 points; 1 point is the same.

#### TOP-13 `revolve_swept_only_after_admission` (class B, effort S)

Modules: `kernel/revolve.bend`.

```python
law revolve_swept_admitted:
  for +profile: List<&2, Rv.Ring>
  for +t: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  for -s: A.Solid
  for h: {Rv.revolve(profile, t, o, axis, x) == Rv.Swept{s} : Rv.Revolved}
  {Rv.rejection(profile, t) == 0 : U32}
```

- **Value:** Admission-by-type (9467cfb) as a theorem: no later refactor can open a path to Swept that skips rejection(). Bugs: 9467cfb (revolve: supported() was a predicate nothing called; a 2-point profile built coincident planes that validated; clockwise profiles and ulp-thin segments were accepted).
- **Provability:** class B; generalize over the reason word; needs Lib.u32.is_eq_sound (is_eq(a, b) = True implies a == b) and constructor disjointness.
- **Effort:** S. is_eq_sound is a Word induction of the size of the probed reflexivity lemma; the rest is two case splits.

#### TOP-14 `pierce_bored_only_after_admission` (class B, effort S)

Modules: `kernel/pierce.bend`.

```python
law pierce_bored_admitted:
  for +target: A.Solid
  for +origin: PG.Vec3
  for +axis: PG.Vec3
  for +radius: R.Real
  for +low: R.Real
  for +high: R.Real
  for +tol: R.Real
  for -s: A.Solid
  for h: {Pc.pierce(target, origin, axis, radius, low, high, tol) == Pc.Bored{s} : Pc.Pierced}
  {Pc.decline(target, origin, axis, radius, low, high, tol) == 0 : U32}
```

- **Value:** A bore can only exist after all eight admissions passed (08463e5 and 1d73cd1 each added one). Bugs: 08463e5 (pierce: inner-loop direction keyed on same_sense gave a doubled edge use on planar bodies; a blind tool cut a full through hole); 1d73cd1 (pierce: a hole far outside the outline was admitted with an invented wall; the volume came from the recorded volume and was never integrated); 79bbfee (pierce: a second hole was refused; a hole cutting into an earlier hole must be refused, not merged).
- **Provability:** class B; as TOP-13.
- **Effort:** S. Same proof shape as TOP-13.

#### TOP-15 `pierce_counts` (class B, effort M)

Modules: `kernel/pierce.bend`.

```python
law pierce_counts:
  for +target: A.Solid
  for +origin: PG.Vec3
  for +axis: PG.Vec3
  for +radius: R.Real
  for +tol: R.Real
  {Spec.a_counts(Pc.bore(target, origin, axis, radius, tol)) == Spec.add_counts(Spec.a_counts(target), Spec.Counts{2n, 3n, 1n, 1n+U32.to_nat(Pc.pierced_count(Spec.a_faces(target), axis, tol, 0))}) : Spec.Counts}
```

- **Value:** A bore adds exactly 2 vertices, 3 edges, 1 face and one hole loop per pierced face (the same perpendicular() predicate drives both counts); with two pierced faces the genus rises by one. Detects a hole loop landing on a face that is not pierced. Bugs: 79bbfee (pierce: a second hole was refused; a hole cutting into an earlier hole must be refused, not merged).
- **Provability:** class B; Bool generalization over perpendicular(...) (opaque) plus a U32 accumulator lemma for pierced_count.
- **Effort:** M. bored_faces and pierced_count walk the same list with the same opaque predicate; the accumulator needs to_nat(acc + 1) = to_nat(acc) + 1 below 2^32.

#### TOP-16 `pierce_skeleton_paired` (class B, effort L)

Modules: `kernel/pierce.bend`.

```python
law pierce_skeleton_paired:
  for +target: A.Solid
  for +origin: PG.Vec3
  for +axis: PG.Vec3
  for +radius: R.Real
  for +tol: R.Real
  for h0: {S.edges_closed(Spec.a_edges(target), Spec.a_faces(target), 0) == True{} : Bool}
  for h1: {Spec.hole_bits(Spec.a_faces(Pc.bore(target, origin, axis, radius, tol)), Spec.a_edge_count(target)) == Spec.EntryForwardExitBackward{} : Spec.HoleBits}
  {S.edges_closed(Spec.a_edges(Pc.bore(target, origin, axis, radius, tol)), Spec.a_faces(Pc.bore(target, origin, axis, radius, tol)), 0) == True{} : Bool}
```

- **Value:** Separates the combinatorial half of 08463e5 (provable: if the two hole loops take the entry circle forward and the exit circle backward, the shell stays paired) from the geometric half (that admission produces those bits; class C, GEO-04). Bugs: 08463e5 (pierce: inner-loop direction keyed on same_sense gave a doubled edge use on planar bodies; a blind tool cut a full through hole).
- **Provability:** class B; conditional law; the hole bits are abstracted into a hypothesis.
- **Effort:** L. Needs count_faces over appended faces and edges, the new indices ne..ne+2 distinct from all old ones (U32 bounds), and preservation of the old pairing.

#### TOP-17 `seam_used_once_each_way` (class B, effort S)

Modules: `kernel/analytic.bend`, `kernel/solid-classification.bend`.

```python
law seam_pair_face_uses:
  for +e0: U32
  for +f0: Bool
  for +e1: U32
  for +f1: Bool
  for +n: U32
  for h0: {U32.is_eq(e0, n) == False{} : Bool}
  for h1: {U32.is_eq(e1, n) == False{} : Bool}
  {S.count_uses([T.Use{e0, f0}, T.Use{n, True{}}, T.Use{e1, f1}, T.Use{n, False{}}], n) == S.UseCount{1, 1} : S.UseCount}
```

- **Value:** The explicit seam that A.with_seams adds to periodic faces (coaxial Booleans) is used exactly once each way.
- **Provability:** class B; rewrite with both hypotheses plus Lib.u32.is_eq_refl (checked in the probe).
- **Effort:** S. Proven in smoke3.bend (three rewrites plus u32_eq_refl). Lifting it to with_seams needs the e0, e1 < |edges| bound.

#### TOP-18 `coaxial_components_keep_cells` (class A, effort M)

Modules: `kernel/boolean.bend`.

```python
law coaxial_components_keep_cells:
  for +cells: List<&2, B.Cell>
  for h: {Nat.is_le(List.length(&2, B.Cell, cells), 6n) == True{} : Bool}
  Spec.Perm(B.Cell, List.concat(&2, B.Cell, B.components(6n, cells)), cells)
```

Helpers: Spec.Perm: inductive permutation relation (Lib.perm).

- **Value:** B.components returns Nil when its fuel runs out, so remaining material cells vanish without an error. The comment says six passes suffice for the 3x2 arrangement; the law makes that a theorem, so no body can disappear from a coaxial Boolean.
- **Provability:** class A; permutation library; flood_pass partitions pending cells regardless of the (opaque) adjacency Bool.
- **Effort:** M. Needs Lib.perm and a measure argument (each component removes at least its seed cell), all over Nat and ADTs.

#### TOP-19 `coaxial_flood_complete` (class B, effort S)

Modules: `kernel/boolean.bend`.

```python
# one law per subset of the 3x2 grid (64, generated), e.g. an L shape:
law coaxial_flood_L:
  for +z0: R.Real
  for +z1: R.Real
  for +z2: R.Real
  for +r0: R.Real
  for +r1: R.Real
  {Spec.component_sizes(B.components(6n, [Spec.cell(0, 0), Spec.cell(1, 0), Spec.cell(1, 1)])) == [3n] : List<&2, Nat>}
```

- **Value:** Flood fill neither splits one connected material region into two bodies nor merges separate ones, for every possible cell set of the coaxial arrangement.
- **Provability:** class B; finite enumeration by computation (literal U32 cell indices, opaque reals); laws generated by a script.
- **Effort:** S. The domain is finite (2^6 subsets); each law is {==}; the cost is the generator.

#### TOP-20 `coaxial_boundary_paired` (class B, effort M)

Modules: `kernel/boolean.bend`, `kernel/analytic.bend`.

```python
# one law per connected cell set (generated), e.g. a single cell (a plain cylinder):
law coaxial_boundary_cylinder:
  for +z0: R.Real
  for +z1: R.Real
  for +r1: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {S.edges_closed(Spec.a_edges(B.boundary([Spec.cell(0, 0)], B.circles([r1], [z0, z1], o, axis, x, 0), 2, o, axis, x)), Spec.a_faces(B.boundary([Spec.cell(0, 0)], B.circles([r1], [z0, z1], o, axis, x, 0), 2, o, axis, x)), 0) == True{} : Bool}
```

- **Value:** The whole combinatorics of the coaxial Boolean (caps, walls, hole loops, compaction, seams) is a finite function of the cell set, so it can be proven exhaustively. This is the analytic hole and boss path.
- **Provability:** class B; finite enumeration by computation, generated.
- **Effort:** M. Generator plus the index and remap computations per case; each case is {==} if B.boundary reduces with opaque reals (the frustum and revolve probes suggest it does).

#### TOP-21 `edges_closed_means_paired` (class B, effort M)

Modules: `kernel/solid-classification.bend`.

```python
law edges_closed_sound:
  for +edges: List<&2, A.Edge>
  for +faces: List<&2, A.Face>
  for h: {S.edges_closed(edges, faces, 0) == True{} : Bool}
  for +k: Nat
  for hk: {Nat.is_lt(k, List.length(&2, A.Edge, edges)) == True{} : Bool}
  {S.count_faces(faces, U32.from_nat(k)) == S.UseCount{1, 1} : S.UseCount}
```

- **Value:** S.edges_closed is the gate in planar-boolean, halfspace and solid classification. Proving that it means what its name says protects every admission built on it; an off-by-one inside the checker would silently weaken all of them.
- **Provability:** class B; induction over edges with index = from_nat(k); needs Lib.u32 (add_one_is_inc, is_eq_sound).
- **Effort:** M. The checker is simple; the cost is the U32/Nat index bridge.

#### TOP-22 `vertex_links_are_cycles` (class B, effort L)

Modules: `kernel/ports/curved-contact-topology.bend`.

```python
law ct_valid_sound:
  for +s: A.Solid
  for h: {CT.valid(s) == True{} : Bool}
  {Spec.vertex_manifold(s) == True{} : Bool}
```

Helpers: Spec.vertex_manifold: independent statement that the corner arcs at each vertex form exactly one cycle.

- **Value:** The vertex-manifold gate used by planar-boolean and the curved ports. Worth proving because the walk uses fuel and an edge-end encoding (2*a + bit).
- **Provability:** class B; take/walk invariants; edge-end arithmetic 2*a + b.
- **Effort:** L. Needs a reference spec plus reasoning about take/walk and U32 doubling.

#### TOP-23 `stitch_sound` (class B, effort L)

Modules: `kernel/boundary.bend`.

```python
law stitch_sound:
  for +edges: List<&2, A.Edge>
  for +vertex_count: U32
  for +uses: List<&2, T.Coedge>
  for -rings: List<&2, Bd.Ring>
  for h: {Bd.stitch(edges, vertex_count, uses) == Bd.Stitched{rings} : Bd.StitchResult}
  {Spec.rings_closed_partition(edges, rings, uses) == True{} : Bool}
```

Helpers: Spec.rings_closed_partition: every ring is a closed walk (end of use i = start of use i+1, cyclically) and the concatenated rings are a permutation of uses.

- **Value:** Bd.stitch closes halfspace caps and section contours. A mis-stitched ring is combinatorially plausible and geometrically wrong; soundness makes Stitched a certificate.
- **Provability:** class B; take/walk induction with Lib.u32.is_eq_sound; Lib.perm.
- **Effort:** L. Fuel-driven walk plus put_back reordering and permutation bookkeeping.

#### TOP-24 `compact_remap_consistent` (class B, effort L)

Modules: `kernel/halfspace.bend`.

```python
law compact_remap_consistent:
  for +vertices: List<&2, PG.Vec3>
  for +edges: List<&2, A.Edge>
  for +i: U32
  for h: {H.vertex_used(edges, i) == True{} : Bool}
  {List.get(&2, PG.Vec3, Spec.compact_vertices(H.compact(vertices, edges, 0, 0)), U32.to_nat(H.mapped(Spec.compact_map(H.compact(vertices, edges, 0, 0)), i))) == List.get(&2, PG.Vec3, vertices, U32.to_nat(i)) : Maybe<&2, PG.Vec3>}
```

- **Value:** H.compact and H.mapped are reused by halfspace, occt, curved and curved-contact. A miss returns 4294967295, which H.point turns into (0,0,0) without error: a wrong but well-formed vertex. The law rules out any used vertex being remapped wrongly or to the sentinel.
- **Provability:** class B; two U32 counters (before, after); Lib.u32 plus List.get lemmas.
- **Effort:** L. Counter arithmetic in U32 and the Bool-dependent after counter. Cheaper after PR-4 (Maybe instead of a sentinel).
- **Related proposal:** PR-4.

#### TOP-25 `remaps_never_hit_sentinel` (class B, effort M)

Modules: `kernel/boolean.bend`, `kernel/ports/truck-topology.bend`, `kernel/ports/solvespace.bend`, `kernel/ports/curved-edges.bend`.

```python
law coaxial_remap_total:
  for +circles: List<&2, A.Edge>
  for +faces: List<&2, A.Face>
  for +old: U32
  for h: {B.referenced(faces, old) == True{} : Bool}
  for hb: {Nat.is_lt(List.length(&2, A.Edge, circles), 4294967295n) == True{} : Bool}
  {U32.is_eq(B.index_of(B.used_indices(circles, faces, 0), old, 0), 4294967295) == False{} : Bool}
```

- **Value:** The same sentinel class sits in boolean.index_of, truck-topology.lookup, solvespace edge_index and curved-edges.mapped: a missed lookup yields index 4294967295 and later a default edge or point instead of an error.
- **Provability:** class B; membership lemma for used_indices plus an index bound.
- **Effort:** M. One lemma pattern, repeated per module (4 sites).
- **Related proposal:** PR-4.

#### TOP-26 `truck_components_keep_faces` (class A, effort M)

Modules: `kernel/ports/truck-topology.bend`.

```python
law truck_components_keep_faces:
  for +records: List<&2, Tt.FaceRecord>
  for +vertices: List<&2, PG.Vec3>
  for +edges: List<&2, A.Edge>
  for +origins: List<&2, P.EdgeOrigin>
  {Spec.component_face_total(Tt.components(List.length(&2, Tt.FaceRecord, records), records, vertices, edges, origins)) == List.length(&2, Tt.FaceRecord, records) : Nat}
```

- **Value:** Tt.components returns Nil when its fuel runs out, which would drop faces without an error. With fuel = |records| every face lands in exactly one component.
- **Provability:** class A; measure argument: each round removes its seed face; partition lemma that ignores the Bool.
- **Effort:** M. grow() also uses decreasing fuel; needs a partition/length lemma set.

#### TOP-27 `planar_boolean_result_gated` (class A, effort M)

Modules: `kernel/ports/planar-boolean.bend`.

```python
law planar_union_gated:
  for +first: A.Solid
  for +ad: List<&2, F.DomainChoice>
  for +ab: R.Real
  for +second: A.Solid
  for +bd: List<&2, F.DomainChoice>
  for +bb: R.Real
  for +tol: I.Tolerance
  for -bodies: List<&2, PT.Body>
  for -budget: R.Real
  for -stats: PT.Stats
  for h: {PB.union(first, ad, ab, second, bd, bb, tol) == PT.Bodies{bodies, budget, stats} : PT.Result}
  {Spec.all_bodies_pass_ct(bodies) == True{} : Bool}
```

- **Value:** Gate coverage: every published body passed CT.valid (stronger forms add S.edges_closed and the CV/V audit Bools). This is the 9467cfb bug class (a validator nothing called) for the main Boolean, and it stays true under any refactor of the pipeline. Bugs: 9467cfb (revolve: supported() was a predicate nothing called; a 2-point profile built coincident planes that validated; clockwise profiles and ulp-thin segments were accepted).
- **Provability:** class A; one lemma per pipeline stage ("result is Bodies implies the stage Bool was True"); the audits stay opaque Bools.
- **Effort:** M. About 12 stages from operate() to mapped_edges(); each lemma is a case split plus a Bool generalization. No arithmetic.

#### TOP-28 `halfspace_result_gated` (class A, effort S)

Modules: `kernel/halfspace.bend`.

```python
law halfspace_publishes_validated_topology:
  for +solid: A.Solid
  for +resolution: R.Real
  for -s: A.Solid
  for -v: R.Real
  for -b: A.Bounds
  for h: {H.result(solid, resolution) == H.Solid{s, v, b} : H.ClipResult}
  {Spec.a_skeleton(s) == Spec.a_skeleton(solid) : Spec.Skeleton}

# together with: H.result(...) == H.Solid{..} implies H.valid(solid, resolution) == True{}
```

- **Value:** H.result validates solid but publishes canonical(solid). The law shows canonicalization cannot change topology, so the discrete half of H.valid (Euler, pairing, connectivity, unique edges) transfers to the published body; the geometric half does not (recomputed frames, class C).
- **Provability:** class A; canonical_edges and canonical_faces keep indices and loops (structural induction).
- **Effort:** S. Two small inductions plus the gate lemma on measured().

#### TOP-29 `port_results_gated` (class A, effort M)

Modules: `kernel/ports/hybrid.bend`, `kernel/ports/curved.bend`, `kernel/ports/occt.bend`, `kernel/ports/solvespace.bend`, `kernel/ports/truck.bend`, `kernel/ports/curved-contact.bend`.

```python
law hybrid_clip_gated:
  for +solid: A.Solid
  for +domains: List<&2, F.DomainChoice>
  for +origin: PG.Vec3
  for +normal: PG.Vec3
  for +tol: I.Tolerance
  for +budget: R.Real
  for -bodies: List<&2, P.Component>
  for h: {Hy.clip(solid, domains, origin, normal, tol, budget) == P.Components{bodies} : P.Result}
  {Spec.all_components_audited(bodies) == True{} : Bool}
```

- **Value:** The gate-coverage guarantee for each clip port: a Clipped or Components result implies its Pieces.valid audit was True. Bugs: 9467cfb (revolve: supported() was a predicate nothing called; a 2-point profile built coincident planes that validated; clockwise profiles and ulp-thin segments were accepted).
- **Provability:** class A; as TOP-27, per port.
- **Effort:** M. S-M per port; six ports.

#### TOP-30 `euler_gate_matches_nat` (class B, effort M)

Modules: `kernel/halfspace.bend`, `kernel/ports/solvespace.bend`.

```python
law euler_gate_nat:
  for +nv: Nat
  for +ne: Nat
  for +nf: Nat
  for h: {Nat.is_lt(Nat.add(nv, Nat.add(nf, ne)), 4294967294n) == True{} : Bool}
  {U32.is_eq((U32.from_nat(nv) + U32.from_nat(nf) : U32), (U32.from_nat(ne) + 2 : U32)) == Nat.is_eq(Nat.add(nv, nf), Nat.add(ne, 2n)) : Bool}
```

- **Value:** The genus-0 gate is computed in wrapping U32. Low value today (source sizes are capped at 256/512); listed for completeness.
- **Provability:** class B; Lib.u32 from_nat homomorphism and injectivity below 2^32.
- **Effort:** M. Pure lemma-library work.

#### ALN-01 `edge_tables_stay_aligned` (class A, effort S)

Modules: `kernel/ports/occt-edges.bend`, `kernel/ports/curved-edges.bend`.

```python
law occt_append_edge_aligned:
  for +edge: A.Edge
  for +origin: P.EdgeOrigin
  for +t: OE.Table
  for h: {Spec.table_aligned(t) == True{} : Bool}
  {Spec.table_aligned(OE.append_edge(edge, origin, t)) == True{} : Bool}
```

Helpers: Spec.table_aligned(t): |edges| = |domains| = |origins|.

- **Value:** The ports carry parallel lists (edges, domains, origins, blocks). A missing append in one list silently shifts every later domain or provenance entry by one edge.
- **Provability:** class A; length_append lemma (checked in the probe).
- **Effort:** S. One lemma per append site; length_append is already checked.

### 5.2 Exact arithmetic and predicate symmetries

| ID | Law | Class | Effort | Status | Prio |
|---|---|---|---|---|---:|
| EXA-01 | `big_make_no_negative_zero` | A | XS | proven-in-probe | 1 |
| EXA-02 | `big_sign_neg` | A | XS | proven-in-probe | 1 |
| EXA-03 | `big_neg_involution` | A | XS | proposed | 3 |
| EXA-04 | `big_mul_sign_neg_left` | A | S | proposed | 2 |
| EXA-05 | `big_mag_add_comm` | B | S | proposed | 2 |
| EXA-06 | `big_mag_cmp_antisym` | B | S | proposed | 2 |
| EXA-07 | `big_add_comm` | B | M | proposed | 2 |
| EXA-08 | `point_plane_exact_antisym` | B | M | proposed | 1 |
| EXA-09 | `indirect_endpoint_reversal` | B | M | proposed | 2 |
| EXA-10 | `big_canonical_closed` | B | L | proposed | 3 |
| EXA-11 | `big_mag_add_correct` | B | L | proposed | 2 |
| EXA-12 | `big_mag_mul_correct` | B | XL | proposed | 3 |
| EXA-13 | `invalid_input_never_signed` | A | XS | proven-in-probe | 1 |
| EXA-14 | `from_word_exact` | C | - | runtime | 1 |
| EXA-15 | `float_filter_sound` | C | - | runtime | 1 |
| EXA-16 | `double_word_error_free` | C | - | runtime | 2 |
| EXA-17 | `unsafe_expansion_never_certifies` | A | XS | proven-in-probe | 2 |
| EXA-18 | `word_identity_is_equivalence` | B | S | proposed | 2 |
| EXA-19 | `u32_lemma_library` | B | M | partly-proven-in-probe | 1 |

#### EXA-01 `big_make_no_negative_zero` (class A, effort XS)

Modules: `kernel/robust-predicates.bend`.

```python
law big_make_no_negative_zero:
  for +n: Bool
  {RP.sign(RP.make(n, Nil{})) == RP.ExactlyZero{} : RP.Sign}
```

- **Value:** Zero has one representation, so a zero determinant can never report Negative.
- **Provability:** class A; computation.
- **Effort:** XS. Proven in smoke2.bend.

#### EXA-02 `big_sign_neg` (class A, effort XS)

Modules: `kernel/robust-predicates.bend`.

```python
law big_sign_neg:
  for +a: RP.Big
  {RP.sign(RP.neg(a)) == Spec.flip_sign(RP.sign(a)) : RP.Sign}
```

- **Value:** Negation flips the exact sign for every Big, canonical or not; the root of all predicate antisymmetries.
- **Provability:** class A; case split on the sign bit and the digit list.
- **Effort:** XS. Proven in smoke.bend.

#### EXA-03 `big_neg_involution` (class A, effort XS)

Modules: `kernel/robust-predicates.bend`.

```python
law big_neg_involution:
  for +a: RP.Big
  for h: {Spec.canonical(a) == True{} : Bool}
  {RP.neg(RP.neg(a)) == a : RP.Big}
```

- **Value:** Double negation is the identity on canonical integers (false for Big{True, Nil}, hence the hypothesis).
- **Provability:** class A; case split; Spec.canonical = negative implies nonempty, top digit nonzero.
- **Effort:** XS. Case analysis only.

#### EXA-04 `big_mul_sign_neg_left` (class A, effort S)

Modules: `kernel/robust-predicates.bend`.

```python
law big_mul_sign_neg_left:
  for +a: RP.Big
  for +b: RP.Big
  {RP.sign(RP.mul(RP.neg(a), b)) == Spec.flip_sign(RP.sign(RP.mul(a, b))) : RP.Sign}
```

- **Value:** The sign of a product flips with one factor, independent of digit arithmetic (the magnitude term is the same on both sides).
- **Provability:** class A; Bool generalization over empty(mag_mul(ad, bd)); lemma mag_mul(Nil, _) = Nil.
- **Effort:** S. No U32 arithmetic, because mag_mul appears identically on both sides.

#### EXA-05 `big_mag_add_comm` (class B, effort S)

Modules: `kernel/robust-predicates.bend`.

```python
law big_mag_add_comm:
  for +a: List<&2, U32>
  for +b: List<&2, U32>
  for +c: U32
  {RP.mag_add(a, b, c) == RP.mag_add(b, a, c) : List<&2, U32>}
```

- **Value:** Magnitude addition is symmetric: the first half of add/sub antisymmetry.
- **Provability:** class B; list induction using U32.add_comm, which Base already proves.
- **Effort:** S. Base proves U32.add_comm; only (ah + bh) + carry needs rewriting.

#### EXA-06 `big_mag_cmp_antisym` (class B, effort S)

Modules: `kernel/robust-predicates.bend`.

```python
law big_mag_cmp_antisym:
  for +a: List<&2, U32>
  for +b: List<&2, U32>
  {RP.mag_cmp(a, b) == Spec.cmp_flip(RP.mag_cmp(b, a)) : Cmp}
```

- **Value:** Magnitude comparison is antisymmetric: the second half of add/sub antisymmetry.
- **Provability:** class B; Word.cmp antisymmetry (a Word induction shaped like the probed reflexivity lemma).
- **Effort:** S. Lib.u32.cmp_antisym is about 40 lines, then a list induction.

#### EXA-07 `big_add_comm` (class B, effort M)

Modules: `kernel/robust-predicates.bend`.

```python
law big_add_comm:
  for +a: RP.Big
  for +b: RP.Big
  {RP.add(a, b) == RP.add(b, a) : RP.Big}
```

- **Value:** Sums do not depend on operand order, so dot() does not depend on the accumulation order of x, y, z.
- **Provability:** class B; EXA-05 + EXA-06 + case split on add_choice/add_opposite.
- **Effort:** M. Case analysis over sign combinations and the three comparison outcomes.

#### EXA-08 `point_plane_exact_antisym` (class B, effort M)

Modules: `kernel/robust-predicates.bend`.

```python
law big_sub_antisym:
  for +a: RP.Big
  for +b: RP.Big
  for ha: {Spec.canonical(a) == True{} : Bool}
  for hb: {Spec.canonical(b) == True{} : Bool}
  {RP.sign(RP.sub(a, b)) == Spec.flip_sign(RP.sign(RP.sub(b, a))) : RP.Sign}

# corollary for the exact path of point_plane:
law dot_delta_antisym:
  for +n: PG.Vec3
  for +a: PG.Vec3
  for +b: PG.Vec3
  {RP.sign(RP.dot_delta(n, a, b)) == Spec.flip_sign(RP.sign(RP.dot_delta(n, b, a))) : RP.Sign}
```

- **Value:** Swapping point and origin flips the exact point/plane sign: the predicate symmetry the exact fallback must have. The float-filter path is not covered (EXA-15).
- **Provability:** class B; EXA-07 + negation distributes over add for canonical operands + canonicity of dot() results (part of EXA-10).
- **Effort:** M. Needs canonicity of dot() results, which is part of EXA-10.

#### EXA-09 `indirect_endpoint_reversal` (class B, effort M)

Modules: `kernel/robust-predicates.bend`.

```python
law indirect_endpoint_reversal:
  for +alpha: RP.Big
  for +beta: RP.Big
  for +gamma: RP.Big
  for +delta: RP.Big
  {Spec.decision_sign(RP.indirect_values(beta, alpha, delta, gamma)) == Spec.decision_sign(RP.indirect_values(alpha, beta, gamma, delta)) : RP.Sign}
```

- **Value:** The implicit line/plane predicate does not depend on which endpoint comes first: numerator and denominator both flip. Today one test case covers endpoint reversal; the law covers all inputs, including Undefined for a zero denominator.
- **Provability:** class B; EXA-08 applied to numerator and denominator; case split in divide_sign.
- **Effort:** M. Builds directly on EXA-08.

#### EXA-10 `big_canonical_closed` (class B, effort L)

Modules: `kernel/robust-predicates.bend`.

```python
law big_add_canonical:
  for +a: RP.Big
  for +b: RP.Big
  for ha: {Spec.canonical(a) == True{} : Bool}
  for hb: {Spec.canonical(b) == True{} : Bool}
  {Spec.canonical(RP.add(a, b)) == True{} : Bool}
```

Helpers: Spec.canonical: all digits < 4096, no most-significant zero digit, negative implies nonempty.

- **Value:** The digit bound < 4096 keeps the comment "a digit product plus carry is < 2^24" true, which is what rules out U32 overflow in mag_scale.
- **Provability:** class B; U32 bound lemmas for and(x, 4095) and shrn(x, 12).
- **Effort:** L. Needs Word-level bit reasoning about and/shift, none of which is in Base.

#### EXA-11 `big_mag_add_correct` (class B, effort L)

Modules: `kernel/robust-predicates.bend`.

```python
law big_mag_add_correct:
  for +a: List<&2, U32>
  for +b: List<&2, U32>
  for +c: U32
  for ha: {Spec.digits_ok(a) == True{} : Bool}
  for hb: {Spec.digits_ok(b) == True{} : Bool}
  for hc: {U32.is_lt(c, 2) == True{} : Bool}
  {Spec.value(RP.mag_add(a, b, c)) == Nat.add(Spec.value(a), Nat.add(Spec.value(b), U32.to_nat(c))) : Nat}
```

Helpers: Spec.value(ds) = sum of ds[i] * 4096^i over Nat.

- **Value:** Correctness, not just symmetry, of the exact fallback: every robust sign rests on it. A carry bug would mis-sign rare inputs that random tests may never draw.
- **Provability:** class B; U32-to-Nat homomorphism: to_nat(and(x, 4095)) + 4096 * to_nat(shrn(x, 12)) = to_nat(x); to_nat(a + b) = to_nat(a) + to_nat(b) without overflow.
- **Effort:** L. The Word(32n) homomorphism lemmas are the expensive part (Base has none). Becomes class A and M effort if the digits move to Nat (PR-8).
- **Related proposal:** PR-8.

#### EXA-12 `big_mag_mul_correct` (class B, effort XL)

Modules: `kernel/robust-predicates.bend`.

```python
law big_mag_mul_correct:
  for +a: List<&2, U32>
  for +b: List<&2, U32>
  for ha: {Spec.digits_ok(a) == True{} : Bool}
  for hb: {Spec.digits_ok(b) == True{} : Bool}
  {Spec.value(RP.mag_mul(a, b)) == Nat.mul(Spec.value(a), Spec.value(b)) : Nat}
```

- **Value:** Completes exact-arithmetic correctness (with EXA-11 and a mag_sub twin).
- **Provability:** class B; EXA-11 plus a U32 multiplication homomorphism below 2^24.
- **Effort:** XL. A Word-level multiplication lemma is research-grade in this checker today.
- **Related proposal:** PR-8.

#### EXA-13 `invalid_input_never_signed` (class A, effort XS)

Modules: `kernel/robust-predicates.bend`.

```python
law point_plane_invalid_normal:
  for +n: PG.Vec3
  for +p: PG.Vec3
  for +o: PG.Vec3
  for h: {RP.vec_valid(n) == False{} : Bool}
  {RP.point_plane(n, p, o) == RP.Decision{RP.Undefined{}, RP.Invalid{}} : RP.Decision}
```

- **Value:** A rejected word never produces a sign (same for point, origin and LinePlane inputs). That vec_valid really rejects NaN and infinity depends on F32.bits, which the logic cannot see; that half stays tested.
- **Provability:** class A; rewrite with the hypothesis (via Equal.sym).
- **Effort:** XS. Proven in smoke2.bend.

#### EXA-14 `from_word_exact` (class C, effort -)

Modules: `kernel/robust-predicates.bend`.

```python
# cannot be stated: F32.bits is a Base postulate, so the IEEE value of a word is invisible to the logic.
# informal: Spec.value(from_word(w)) * 2^-149 = IEEE754(w) for every finite w
```

- **Value:** Every exact decision starts from this decoding.
- **Provability:** class C; not provable: F32 semantics are postulated.
- **Effort:** -. Out of reach of laws.
- **Covered instead by:** test/robust-predicates.test.mjs decodes the same words with an independent BigInt oracle (subnormals, extreme exponents, random raw words). Add an exhaustive exponent sweep (all 254 finite exponents times boundary mantissas).

#### EXA-15 `float_filter_sound` (class C, effort -)

Modules: `kernel/robust-predicates.bend`.

```python
# informal: filtered(estimate(terms), n, a, b) returns FloatFilter only with the exact sign
```

- **Value:** The 2^-16 bound in the comment is a floating-point error analysis.
- **Provability:** class C; not provable.
- **Effort:** -. IEEE rounding semantics are not in the logic.
- **Covered instead by:** Differential test: on adversarial inputs (near cancellation, encoded exponents 86/87/167/168, subnormals) run filtered() and exact_decision() side by side and require equal signs whenever the method is FloatFilter. The current BigInt-oracle tests cover this only indirectly.

#### EXA-16 `double_word_error_free` (class C, effort -)

Modules: `kernel/real.bend`, `kernel/precise.bend`.

```python
# informal: add/mul are error-free transformations; renorm keeps |lo| <= ulp(hi)/2; less/equal order non-NaN pairs totally
```

- **Value:** All geometry is F32x2.
- **Provability:** class C; not provable.
- **Effort:** -. F32.add and friends are postulates in Base.
- **Covered instead by:** test/real.test.mjs compares against a binary64 oracle, which cannot see all 48 bits. Add a BigInt rational oracle over random raw word pairs for add/sub/mul/div/sqrt and for the renormalization invariant.

#### EXA-17 `unsafe_expansion_never_certifies` (class A, effort XS)

Modules: `kernel/intersections.bend`, `kernel/ray.bend`, `kernel/curve-plane.bend`.

```python
law expansion_zero_needs_safe:
  for +words: List<&2, F32>
  {I.expansion_zero(I.Expansion{False{}, words}) == False{} : Bool}

law expansion_add_unsafe:
  for +words: List<&2, F32>
  for +b: I.Expansion
  {I.expansion_zero(I.expansion_add(I.Expansion{False{}, words}, b)) == False{} : Bool}

# expansion_mul and expansion_neg propagate the flag the same way
```

- **Value:** The documented rule "an unavailable certificate keeps the degeneracy unresolved; it never proves a zero" becomes a theorem for the flag logic, through add/neg/mul.
- **Provability:** class A; computation over the safe flag (the words stay opaque).
- **Effort:** XS. Both laws proven in smoke3.bend; mul/neg are the same one-case-split proof.

#### EXA-18 `word_identity_is_equivalence` (class B, effort S)

Modules: `kernel/section.bend`.

```python
law same_real_refl:
  for +a: R.Real
  {Sec.same_real(a, a) == True{} : Bool}

law same_real_sym:
  for +a: R.Real
  for +b: R.Real
  {Sec.same_real(a, b) == Sec.same_real(b, a) : Bool}
```

- **Value:** Root identity in section.bend is word identity via F32.bits and U32.is_eq. Unlike R.equal (F32.is_eq: unprovable, and false for NaN), word identity is provably an equivalence even though F32.bits is opaque; only U32 facts are needed.
- **Provability:** class B; Lib.u32 is_eq_refl (checked) and is_eq_sym.
- **Effort:** S. is_eq_refl is already checked; symmetry and transitivity are similar Word inductions.

#### EXA-19 `u32_lemma_library` (class B, effort M)

Modules: `(Base U32/Word)`.

```python
law u32_eq_refl:
  for +a: U32
  {U32.is_eq(a, a) == True{} : Bool}

# further: is_eq_sound, is_eq_sym, cmp_antisym, add_assoc, add_one_is_inc,
# from_nat_add, to_nat_from_nat (n < 2^32), from_nat_injective (below 2^32)
```

- **Value:** The foundation of every class-B law: index matching, counters and word identity.
- **Provability:** class B; induction over Word(n).
- **Effort:** M. u32_eq_refl (with word_cmp_refl, under 30 lines) is proven in tmp/laws/inventory/u32-refl.bend in 0.07 s. The homomorphism lemmas (from_nat_add, to_nat bounds) are the larger part.

### 5.3 Boolean classification and selection

| ID | Law | Class | Effort | Status | Prio |
|---|---|---|---|---|---:|
| BOO-01 | `boolean_union_partition` | A | XS | existing | 3 |
| BOO-02 | `boolean_differences_disjoint` | A | XS | existing | 3 |
| BOO-03 | `selected_intersection_comm` | A | XS | proven-in-probe | 3 |
| BOO-05 | `unknown_op_code_is_difference` | B | XS | proposed | 3 |
| BOO-06 | `planar_selection_matches_truth_table` | A | XS | proven-in-probe | 1 |
| BOO-07 | `unresolved_membership_rejects` | A | XS | proven-in-probe | 1 |
| BOO-09 | `selection_merge_laws` | B | S | partly-proven-in-probe | 2 |
| BOO-10 | `parallel_select_equals_fold` | B | L | proposed | 1 |
| BOO-11 | `votes_need_agreement` | B | S | partly-proven-in-probe | 2 |
| BOO-13 | `undecidable_contact_never_routes` | A | XS | proven-in-probe | 1 |
| BOO-14 | `audits_only_reject` | A | S | proposed | 2 |
| BOO-15 | `no_partial_bodies` | A | S | partly-proven-in-probe | 1 |
| BOO-16 | `unknown_bounds_never_decide` | A | XS | proven-in-probe | 1 |
| BOO-17 | `exact_band_needs_certificate` | A | XS | proven-in-probe | 2 |
| BOO-18 | `enclosed_void_unsupported` | A | XS | proposed | 3 |
| BOO-19 | `classification_is_geometrically_right` | C | - | runtime | 1 |
| BOO-20 | `pierce_in_material` | C | - | runtime | 1 |

#### BOO-01 `boolean_union_partition` (class A, effort XS)

Modules: `kernel/boolean.bend`.

```python
law boolean_union_partition:
  for +a: Bool
  for +b: Bool
  {B.selected(0, a, b) == Bool.or(B.selected(1, a, b), Bool.or(B.selected(2, a, b), B.selected(2, b, a))) : Bool}
```

- **Value:** Existing.
- **Provability:** class A; truth table.
- **Effort:** XS. Existing in LAWS.bend.

#### BOO-02 `boolean_differences_disjoint` (class A, effort XS)

Modules: `kernel/boolean.bend`.

```python
law boolean_differences_disjoint:
  for +a: Bool
  for +b: Bool
  {Bool.and(B.selected(2, a, b), B.selected(2, b, a)) == False{} : Bool}
```

- **Value:** Existing.
- **Provability:** class A; truth table.
- **Effort:** XS. Existing in LAWS.bend.

#### BOO-03 `selected_intersection_comm` (class A, effort XS)

Modules: `kernel/boolean.bend`.

```python
law selected_intersection_comm:
  for +a: Bool
  for +b: Bool
  {B.selected(1, a, b) == B.selected(1, b, a) : Bool}
```

- **Value:** Completes the truth-table spec: intersection and union are symmetric, difference is not.
- **Provability:** class A; truth table.
- **Effort:** XS. Proven in smoke.bend; the union twin is identical.

#### BOO-05 `unknown_op_code_is_difference` (class B, effort XS)

Modules: `kernel/boolean.bend`.

```python
law selected_unknown_op:
  for +op: U32
  for +a: Bool
  for +b: Bool
  for h0: {U32.is_eq(op, 0) == False{} : Bool}
  for h1: {U32.is_eq(op, 1) == False{} : Bool}
  {B.selected(op, a, b) == B.selected(2, a, b) : Bool}
```

- **Value:** Documents a fragile spot: every op code other than 0 and 1 silently means difference. Better removed by PR-5 (op as an ADT), after which this law disappears.
- **Provability:** class B; rewrite with both hypotheses.
- **Effort:** XS. Two rewrites.
- **Related proposal:** PR-5.

#### BOO-06 `planar_selection_matches_truth_table` (class A, effort XS)

Modules: `kernel/ports/planar-boolean-selection.bend`, `kernel/boolean.bend`.

```python
law planar_choose_subtraction:
  for +ai: Bool
  for +bi: Bool
  for +polys: List<&2, H.Polygon>
  for +before: List<&2, H.Polygon>
  for +count: U32
  for +index: U32
  {Q.choose(Q.Membership{True{}, ai}, Q.Membership{True{}, bi}, polys, Q.Selection{before, count}, index, True{})
    == Q.Selection{Bool.pick(List<&2, H.Polygon>, B.selected(2, ai, bi), List.append(&2, H.Polygon, before, polys), before),
      (count + Bool.pick(U32, B.selected(2, ai, bi), 1, 0) : U32)} : Q.Selection}

# and planar_choose_union: subtraction = False{} with B.selected(0, ai, bi)
```

- **Value:** Two independent encodings of one truth table (boolean.bend op codes, the planar selection subtraction flag) are tied together, so the truth-table laws in LAWS.bend now cover the planar Boolean as well.
- **Provability:** class A; truth table (U32 literal arithmetic reduces).
- **Effort:** XS. Both laws proven in smoke2.bend.

#### BOO-07 `unresolved_membership_rejects` (class A, effort XS)

Modules: `kernel/ports/planar-boolean-selection.bend`.

```python
law choose_rejects_invalid_first:
  for +x: Bool
  for +b: Q.Membership
  for +polys: List<&2, H.Polygon>
  for +prior: Q.Selection
  for +index: U32
  for +sub: Bool
  {Q.choose(Q.Membership{False{}, x}, b, polys, prior, index, sub) == Q.Failed{P.UnsupportedArrangement{}, 4, index} : Q.Selection}

# plus the second-operand twin and Q.membership(S.Boundary{f}) == Q.Membership{False{}, False{}}
```

- **Value:** A Boundary or Unresolved cell classification can never be treated as outside (silently dropped) or inside (silently kept): AGENTS.md's "never silent fallbacks" for cell selection.
- **Provability:** class A; case split.
- **Effort:** XS. First-operand law proven in smoke.bend.

#### BOO-09 `selection_merge_laws` (class B, effort S)

Modules: `kernel/ports/planar-boolean-selection.bend`.

```python
law merge_failed_left:
  for +reason: P.Reason
  for +stage: U32
  for +bad: U32
  for +b: Q.Selection
  {Q.merge(Q.Failed{reason, stage, bad}, b) == Q.Failed{reason, stage, bad} : Q.Selection}

law merge_assoc:
  for +a: Q.Selection
  for +b: Q.Selection
  for +c: Q.Selection
  {Q.merge(Q.merge(a, b), c) == Q.merge(a, Q.merge(b, c)) : Q.Selection}
```

- **Value:** The lowest-index failure wins and the parallel merge tree may be regrouped: prerequisites of BOO-10. Bugs: 70ac0f4 (planar selection rewritten from a fold into a halving parallel split, claimed bit-identical).
- **Provability:** class B; case split; associativity needs append associativity and U32.add associativity (Lib.u32).
- **Effort:** S. merge_failed_left is proven in smoke.bend; associativity needs Word.add associativity, which Base lacks.

#### BOO-10 `parallel_select_equals_fold` (class B, effort L)

Modules: `kernel/ports/planar-boolean-selection.bend`.

```python
law select_equals_fold:
  for +cells: List<&2, D.Cell>
  for +vertices: List<&2, PG.Vec3>
  for +first: A.Solid
  for +ad: List<&2, F.DomainChoice>
  for +second: A.Solid
  for +bd: List<&2, F.DomainChoice>
  for +tol: I.Tolerance
  for +resolution: R.Real
  for +index: U32
  for +sub: Bool
  {Q.select(List.length(&2, D.Cell, cells), cells, List.length(&2, D.Cell, cells), vertices, first, ad, second, bd, tol, resolution, index, sub)
    == Spec.select_fold(cells, vertices, first, ad, second, bd, tol, resolution, index, sub) : Q.Selection}
```

Helpers: Spec.select_fold: left fold that classifies each cell with Q.one_cell([cell], .., index + k) and merges in order (the accumulator semantics before 70ac0f4).

- **Value:** Makes the claim of 70ac0f4 permanent ("polygon order, selected count and the lowest-index failure match the fold this replaces") and rules out the silent case: with too little fuel one_cell classifies only the head cell and drops the rest. Every future performance rewrite of selection has to keep this law. Bugs: 70ac0f4 (planar selection rewritten from a fold into a halving parallel split, claimed bit-identical).
- **Provability:** class B; fuel/size induction with the take/drop split, merge associativity and index + from_nat(low) arithmetic; classification stays opaque.
- **Effort:** L. half/take/drop reasoning is Nat (class A); the index offsets need Lib.u32.from_nat_add.

#### BOO-11 `votes_need_agreement` (class B, effort S)

Modules: `kernel/solid-classification.bend`.

```python
law finish_votes_needs_agreement:
  for +count: U32
  for +inside: Bool
  for +conflict: Bool
  for -n: U32
  for h: {S.finish_votes(S.Votes{count, inside, conflict}) == S.Inside{n} : S.Classification}
  {Bool.and(Bool.not(conflict), Bool.not(U32.is_lt(count, 2))) == True{} : Bool}

law add_vote_conflict_monotone:
  for +v: S.Vote
  for +count: U32
  for +inside: Bool
  {Spec.conflict(S.add_vote(v, S.Votes{count, inside, True{}})) == True{} : Bool}
```

- **Value:** Solid membership (used for every planar Boolean cell) is decided only with at least two agreeing valid rays and no conflict, as face-classification.md states.
- **Provability:** class B; case split; count < 2 on a variable needs Lib.u32 order lemmas (the monotone part is class A).
- **Effort:** S. The monotone law is proven in smoke3.bend; the agreement law needs U32 order lemmas; the Outside twin is identical.

#### BOO-13 `undecidable_contact_never_routes` (class A, effort XS)

Modules: `kernel/ports/hybrid.bend`.

```python
law hybrid_invalid_contact_route:
  for +planar: Bool
  for +contact: Bool
  {Hy.choose_route(planar, Hy.ContactState{False{}, contact}) == Hy.InvalidRoute{} : Hy.Route}

law hybrid_undefined_sign_invalidates:
  for +contact: Bool
  for +valid: Bool
  {Hy.contact_sign(RP.Undefined{}, Hy.ContactState{valid, contact}) == Hy.ContactState{False{}, contact} : Hy.ContactState}
```

- **Value:** An Undefined exact contact sign at any vertex ends in InvalidRoute; the hybrid never guesses a constructor. The list-level version (any Undefined vertex through contacts()) is a one-induction corollary.
- **Provability:** class A; computation; list version by induction.
- **Effort:** XS. Both laws proven in smoke2.bend; the list version is S.

#### BOO-14 `audits_only_reject` (class A, effort S)

Modules: `kernel/ports/hybrid.bend`, `kernel/ports/planar-boolean.bend`, `kernel/halfspace.bend`.

```python
law hybrid_audit_only_rejects:
  for +r: P.Result
  for +s: A.Solid
  for +res: R.Real
  {Hy.audit(r, s, res) == r : P.Result} | {Hy.audit(r, s, res) == P.Unresolved{P.ConstructionFailure{}} : P.Result}
```

- **Value:** An audit can reject a result but never alter it. The same shape applies to planar-boolean cavity_checked/audited_component and to H.measured.
- **Provability:** class A; case split on r; Bool generalization over the audit Bool.
- **Effort:** S. Needs one Bool-generalization helper per audit.

#### BOO-15 `no_partial_bodies` (class A, effort S)

Modules: `kernel/ports/planar-boolean.bend`, `kernel/ports/solid-intersection.bend`, `kernel/ports/curved-intersection.bend`.

```python
law planar_add_body_unresolved_left:
  for +reason: P.Reason
  for +stage: U32
  for +detail: U32
  for +budget: R.Real
  for +stats: PT.Stats
  for +rest: PT.Result
  {PB.add_body(PT.Unresolved{reason, stage, detail, budget, stats}, rest) == PT.Unresolved{reason, stage, detail, budget, stats} : PT.Result}

# plus the right-hand twin, and by induction: one Unresolved component makes PB.components(...) Unresolved
```

- **Value:** "Reject the entire result; never publish just the positive components" (planar-boolean.bend) and "a failed later plane discards the entire result" (solid-/curved-intersection) become theorems.
- **Provability:** class A; case split; fold induction for the list version.
- **Effort:** S. Both add_body laws are proven in smoke2.bend; the fold versions are S per module.

#### BOO-16 `unknown_bounds_never_decide` (class A, effort XS)

Modules: `kernel/face-bounds.bend`, `kernel/ports/curved-retention.bend`.

```python
law bounds_join_unknown_left:
  for +b: FB.Bounds
  {FB.join(FB.UnknownBounds{}, b) == FB.UnknownBounds{} : FB.Bounds}

law bounds_join_unknown_right:
  for +a: FB.Bounds
  {FB.join(a, FB.UnknownBounds{}) == FB.UnknownBounds{} : FB.Bounds}

# corollary: one UnknownBounds face makes curved-retention classify() return Undecided
```

- **Value:** A face whose bounds cannot be computed can never let a whole body be retained or removed.
- **Provability:** class A; case split; corollary by list induction.
- **Effort:** XS. Join laws proven in smoke.bend; the corollary is S.

#### BOO-17 `exact_band_needs_certificate` (class A, effort XS)

Modules: `kernel/curve-band.bend`.

```python
law threshold_never_exact:
  for +within: Bool
  for +exceeds: Bool
  for +ev: CB.Evidence
  {Spec.is_exact_in_plane(CB.classify_threshold(within, exceeds, ev)) == False{} : Bool}
```

- **Value:** ExactCurveInPlane is reachable only through the ExactZeroCoefficients certificate, never through a tolerance threshold (curve-band.md).
- **Provability:** class A; case split.
- **Effort:** XS. Proven in smoke3.bend (three cases).

#### BOO-18 `enclosed_void_unsupported` (class A, effort XS)

Modules: `kernel/boolean.bend`.

```python
law coaxial_void_unsupported:
  for +a0: PG.Vec3
  for +a1: PG.Vec3
  for +ra: R.Real
  for +b0: PG.Vec3
  for +b1: PG.Vec3
  for +rb: R.Real
  for +op: U32
  for h: {Spec.enclosed_void(B.coaxial(a0, a1, ra, b0, b1, rb, op)) == True{} : Bool}
  {Spec.supported(B.coaxial(a0, a1, ra, b0, b1, rb, op)) == False{} : Bool}
```

- **Value:** A subtraction that would leave an internal void is always reported unsupported (void bodies need nesting and STEP roles).
- **Provability:** class A; Bool algebra (supported = not void and ..).
- **Effort:** XS. One Bool generalization.

#### BOO-19 `classification_is_geometrically_right` (class C, effort -)

Modules: `kernel/face-classification.bend`, `kernel/cylinder-classification.bend`, `kernel/solid-classification.bend`.

```python
# informal: classify(solid, p) = Inside iff p lies in the open solid
```

- **Value:** The heart of Boolean correctness.
- **Provability:** class C; not provable.
- **Effort:** -. F32 geometry.
- **Covered instead by:** Run time: five-ray agreement inside S.classify and the boundary short-circuit. Differential: bakeoff against OCCT and Manifold (scripts/bakeoff), planar-difference probes, public-boolean-regressions.

#### BOO-20 `pierce_in_material` (class C, effort -)

Modules: `kernel/pierce.bend`.

```python
# informal: decline(...) = 0 implies the tool axis lies in material on both pierced faces
```

- **Value:** 1d73cd1: a hole a metre away was admitted with invented topology that passed "closed topology". Bugs: 1d73cd1 (pierce: a hole far outside the outline was admitted with an invented wall; the volume came from the recorded volume and was never integrated).
- **Provability:** class C; not provable.
- **Effort:** -. Parity over F32 crossings.
- **Covered instead by:** Run time: integrate the produced body's volume from its faces (ports/curved-metrics.bend volume) and require it to match pierced_volume(); pierced_volume starts from the recorded target volume, which is why 1d73cd1 read the same at every distance. Differential: OCCT solid count = 1 (validate-step.py), bakeoff.

### 5.4 Identity and naming

| ID | Law | Class | Effort | Status | Prio |
|---|---|---|---|---|---:|
| IDN-01 | `framing_injective` | A | L | proposed | 2 |
| IDN-02 | `transform_keeps_origin` | A | XS | proven-in-probe | 2 |
| IDN-03 | `transform_keeps_counts` | A | XS | proposed | 2 |
| IDN-05 | `named_extrusion_counts` | A | S | proposed | 2 |
| IDN-06 | `extrusion_identity_matches_brep` | B | M | proposed | 2 |
| IDN-07 | `semantic_origin_ignores_revision` | A | XS | proven-in-probe | 1 |
| IDN-09 | `distinct_roles_distinct_origins` | A | L | proposed | 3 |
| IDN-10 | `local_roles_distinct` | B | L | proposed | 3 |
| IDN-11 | `determinism` | A | - | by-construction | 3 |

#### IDN-01 `framing_injective` (class A, effort L)

Modules: `kernel/identity.bend`.

```python
law frames_injective:
  for +xs: List<&2, String>
  for +ys: List<&2, String>
  for h: {Id.frames(xs) == Id.frames(ys) : String}
  {xs == ys : List<&2, String>}
```

- **Value:** identity.bend and topology-identity.md claim that framing is injective ("Punctuation and Unicode cannot alias different component sequences"). A collision would merge the persistent IDs of two entities.
- **Provability:** class A; write a decoder and prove decode(frames(xs)) = xs; needs "Nat.show digits contain no colon" and a Nat.read/Nat.show round trip (not in Base).
- **Effort:** L. Nat.show goes through Nat.divmod by 10; its round-trip lemma is the bulk of the work.

#### IDN-02 `transform_keeps_origin` (class A, effort XS)

Modules: `kernel/identity.bend`.

```python
law transformed_keeps_origin:
  for +e: Id.EntityIdentity
  for +op: String
  for +occ: String
  for +rev: String
  {Spec.origin_of(Id.transformed(e, op, occ, rev)) == Spec.origin_of(e) : String}
```

- **Value:** Rigid copies keep the logical origin; only occurrence and lineage change (topology-identity.md, rigid transform/clone).
- **Provability:** class A; destructure.
- **Effort:** XS. Proven in smoke.bend.

#### IDN-03 `transform_keeps_counts` (class A, effort XS)

Modules: `kernel/identity.bend`.

```python
law identity_transform_counts:
  for +set: Id.IdentitySet
  for +op: String
  for +occ: String
  for +rev: String
  {Spec.id_counts(Id.transform(set, op, occ, rev)) == Spec.id_counts(set) : Spec.Counts}
```

- **Value:** Identity arrays stay aligned with the transformed B-rep arrays (positions locate entries).
- **Provability:** class A; map-length induction.
- **Effort:** XS. One length lemma for transformed_list.

#### IDN-05 `named_extrusion_counts` (class A, effort S)

Modules: `kernel/identity.bend`.

```python
law named_extrusion_counts:
  for +ns: String
  for +op: String
  for +occ: String
  for +rev: String
  for +entities: List<&2, String>
  for +junctions: List<&2, String>
  for +positive: Bool
  {Spec.id_counts(Id.named_extrusion(ns, op, occ, rev, entities, junctions, positive))
    == Spec.Counts{Nat.add(List.length(&2, String, junctions), List.length(&2, String, junctions)),
      Nat.add(Nat.add(List.length(&2, String, entities), List.length(&2, String, entities)), List.length(&2, String, junctions)),
      2n+List.length(&2, String, entities)} : Spec.Counts}
```

- **Value:** Named sweep identities have exactly 2J vertices, 2E + J edges and E + 2 faces, matching the sketch-extrusion B-rep.
- **Provability:** class A; length_append (checked) plus roles/sweep_roles length lemmas.
- **Effort:** S. The lemmas are the ones exercised in the probe.

#### IDN-06 `extrusion_identity_matches_brep` (class B, effort M)

Modules: `kernel/identity.bend`, `kernel/topology.bend`.

```python
law extrusion_identity_matches_brep:
  for +points: List<&2, G.Vec3>
  for +delta: G.Vec3
  for +ns: String
  for +op: String
  for +occ: String
  for +rev: String
  for h: {Nat.is_lt(List.length(&2, G.Vec3, points), 1431655765n) == True{} : Bool}
  {Spec.id_counts(Id.extrusion(ns, op, occ, rev, U32.from_nat(List.length(&2, G.Vec3, points)))) == Spec.t_counts(T.extrude(points, delta)) : Spec.Counts}
```

- **Value:** Identity records index the B-rep arrays by position; a count mismatch silently assigns identities to the wrong entities. The bound keeps 3n inside U32.
- **Provability:** class B; TOP-05 + to_nat((k * n : U32)) = k * to_nat(n) below 2^32.
- **Effort:** M. U32 multiplication bridge; instances are XS.

#### IDN-07 `semantic_origin_ignores_revision` (class A, effort XS)

Modules: `kernel/identity.bend`.

```python
law semantic_origin_ignores_revision:
  for +ns: String
  for +op: String
  for +occ: String
  for +r1: String
  for +r2: String
  for +kind: String
  for +role: String
  for +parents: List<&2, Id.ParentIdentity>
  {Spec.origin_of(Id.created(ns, op, occ, r1, kind, role, "semantic", parents)) == Spec.origin_of(Id.created(ns, op, occ, r2, kind, role, "semantic", parents)) : String}
```

- **Value:** A dimension change (new revision) keeps semantic and source origins: the stability contract of topology-identity.md. Same statement for "source" and for from_source with a known namespace.
- **Provability:** class A; computation (String.eq on literals reduces).
- **Effort:** XS. Proven in smoke2.bend.

#### IDN-09 `distinct_roles_distinct_origins` (class A, effort L)

Modules: `kernel/identity.bend`.

```python
law distinct_roles_distinct_origins:
  for +ns: String
  for +op: String
  for +kind: String
  for +r1: String
  for +r2: String
  for +rev: String
  for +parents: List<&2, Id.ParentIdentity>
  for h: {r1 != r2 : String}
  {Spec.origin_of(Id.created(ns, op, "o", rev, kind, r1, "semantic", parents)) != Spec.origin_of(Id.created(ns, op, "o", rev, kind, r2, "semantic", parents)) : String}
```

- **Value:** Two semantic roles never share an origin key.
- **Provability:** class A; IDN-01 + injectivity of the concatenated framing.
- **Effort:** L. Rides entirely on IDN-01.

#### IDN-10 `local_roles_distinct` (class B, effort L)

Modules: `kernel/identity.bend`.

```python
# informal: local_roles(k, 0, prefix) has pairwise distinct entries for k < 2^32
```

- **Value:** Revision-local positional roles are distinct.
- **Provability:** class B; U32.show injective (Base has no such lemma).
- **Effort:** L. Decimal rendering of U32 through Word division.

#### IDN-11 `determinism` (class A, effort -)

Modules: `kernel/identity.bend`.

```python
# no law needed: identity keys are pure functions of their String/U32 arguments
```

- **Value:** Determinism is free in Bend: no clock, randomness, hash iteration order or host state reaches these defs. The law-worthy questions are stability (IDN-07) and injectivity (IDN-01).
- **Provability:** class A; by construction.
- **Effort:** -. Nothing to prove.

### 5.5 Wire codecs of the native binding

| ID | Law | Class | Effort | Status | Prio |
|---|---|---|---|---|---:|
| WIR-01 | `adt_roundtrip` | A | M | proposed | 2 |
| WIR-02 | `list_count_roundtrip` | B | M | proposed | 2 |
| WIR-03 | `string_roundtrip` | B | M | proposed | 3 |
| WIR-04 | `f32_leaf_roundtrip` | A | XS | proven-in-probe | 2 |
| WIR-05 | `decode_canonical` | B | M | proposed | 3 |
| WIR-06 | `js_and_c_codecs_agree` | C | - | runtime | 2 |

#### WIR-01 `adt_roundtrip` (class A, effort M)

Modules: `scripts/native-bridge/gen-wire.mjs (generated wire.bend)`.

```python
# generated per type, e.g.
law wire_domain_choice_roundtrip:
  for +x: F.DomainChoice
  for +rest: List<&2, U32>
  {W.dec_DomainChoice(W.Cursor{True{}, W.enc_DomainChoice(x, rest)}) == (x, W.Cursor{True{}, rest}) : F.DomainChoice & W.Cursor}
```

- **Value:** The native binding contract: every value that crosses the boundary comes back identical. Laws generated next to the codec keep generator edits honest.
- **Provability:** class A; constructor case split plus field lemmas, generated mechanically.
- **Effort:** M. Per-type proofs are mechanical; the generator must emit them (PR-6). The leaves are WIR-02 to WIR-04.
- **Related proposal:** PR-6.

#### WIR-02 `list_count_roundtrip` (class B, effort M)

Modules: `scripts/native-bridge/gen-wire.mjs`.

```python
law to_nat_from_nat:
  for +n: Nat
  for h: {Nat.is_lt(n, 4294967296n) == True{} : Bool}
  {U32.to_nat(U32.from_nat(n)) == n : Nat}
```

- **Value:** List and String length words round-trip; lists longer than 2^32 - 1 cannot, and the hypothesis says so explicitly.
- **Provability:** class B; Word induction (Lib.u32).
- **Effort:** M. Needs the relation between Word.inc and Nat.double.

#### WIR-03 `string_roundtrip` (class B, effort M)

Modules: `scripts/native-bridge/gen-wire.mjs`.

```python
law wire_string_roundtrip:
  for +s: String
  for +rest: List<&2, U32>
  for h: {Spec.chars_below(s, 1114112) == True{} : Bool}
  {W.dec_String(W.Cursor{True{}, W.enc_String(s, rest)}) == (s, W.Cursor{True{}, rest}) : String & W.Cursor}
```

- **Value:** Identity strings (IDN-*) cross the binding intact, astral code points included.
- **Provability:** class B; WIR-02 plus the character bound.
- **Effort:** M. Fuel-driven decoder with a reversed accumulator.

#### WIR-04 `f32_leaf_roundtrip` (class A, effort XS)

Modules: `scripts/native-bridge/gen-wire.mjs`.

```python
law f32_structural_roundtrip:
  for +x: F32
  {dec_f32(enc_f32_structural(x)) == x : F32}

# where enc_f32_structural(x) = F32{w} = x; U32{w}   (today the generator uses F32.bits(x), a postulate)
```

- **Value:** With the current F32.bits encoder the F32 leaf cannot be proven (postulate). Switching the generator to structural re-wrapping, which its decoder already uses, makes every Real/Vec3/Solid round trip provable.
- **Provability:** class A; match x: case F32{w}: {==}.
- **Effort:** XS. Proven in smoke2.bend with the structural encoder.
- **Related proposal:** PR-6.

#### WIR-05 `decode_canonical` (class B, effort M)

Modules: `scripts/native-bridge/gen-wire.mjs`.

```python
law wire_decode_canonical:
  for +ws: List<&2, U32>
  for -x: F.DomainChoice
  for h: {W.decode_DomainChoice(ws) == Some{x} : Maybe<&2, F.DomainChoice>}
  {W.encode_DomainChoice(x) == ws : List<&2, U32>}
```

- **Value:** No two accepted frames decode to the same value (the decoder is injective and rejects trailing words); frame-keyed caches rely on that.
- **Provability:** class B; inverse direction of WIR-01 with rejection of non-0/1 Bool words.
- **Effort:** M. Needs decoder-side case analysis on words.

#### WIR-06 `js_and_c_codecs_agree` (class C, effort -)

Modules: `src/native/**`, `generated wire.mjs`.

```python
# outside Bend: JS and C implementations
```

- **Value:** The host halves of the codec.
- **Provability:** class C; not in Bend.
- **Effort:** -. Different languages.
- **Covered instead by:** test/native-bridge-wire.test.mjs (Bend/JS round trips, malformed frames); the binding runs word-for-word identical to the JS target (docs/native-bridge/binding.md). The binary64 collapse in src/real.mjs stays a known, tested lossy path.

### 5.6 Sorting, dedup and index helpers

| ID | Law | Class | Effort | Status | Prio |
|---|---|---|---|---|---:|
| SRT-01 | `insertion_sorts_permute` | A | S | proposed | 2 |
| SRT-03 | `coaxial_insert_dedup_length` | A | XS | proposed | 3 |
| SRT-04 | `sorted_after_insert` | C | S | runtime | 3 |
| SRT-05 | `sorted_events_filters_support` | A | S | proposed | 3 |
| SRT-06 | `unique_ids_spec` | B | M | proposed | 3 |
| SRT-08 | `reversals_involutive` | A | XS | proposed | 3 |
| SRT-09 | `take_drop_append` | A | XS | proven-in-probe | 2 |
| SRT-11 | `section_root_dedup` | B | M | proposed | 2 |
| TES-01 | `ring_length_and_clamp` | B | S | proposed | 3 |
| SKL-01 | `source_point_identity_equivalence` | B | S | proposed | 3 |

#### SRT-01 `insertion_sorts_permute` (class A, effort S)

Modules: `kernel/face-plane.bend`, `kernel/ports/occt.bend`, `kernel/ports/curved-edges.bend`, `kernel/ports/solvespace.bend`, `kernel/ports/truck.bend`, `kernel/ports/solvespace-bsp.bend`.

```python
law face_plane_insert_event_perm:
  for +event: FP.BoundaryEvent
  for +sorted: List<&2, FP.BoundaryEvent>
  Spec.Perm(FP.BoundaryEvent, FP.insert_event(event, sorted), event <> sorted)

law face_plane_insert_event_length:
  for +event: FP.BoundaryEvent
  for +sorted: List<&2, FP.BoundaryEvent>
  {List.length(&2, FP.BoundaryEvent, FP.insert_event(event, sorted)) == 1n+List.length(&2, FP.BoundaryEvent, sorted) : Nat}
```

- **Value:** Six hand-written insertion sorts (events, paves, endpoints, cut events, root ids, BSP segments). A sort that drops or duplicates an event breaks span parity or splits an edge twice; the permutation law holds whatever the comparator returns.
- **Provability:** class A; Bool generalization over R.less(..) (opaque) plus Lib.perm.
- **Effort:** S. XS-S per sort once Lib.perm exists; six sorts, one pattern.

#### SRT-03 `coaxial_insert_dedup_length` (class A, effort XS)

Modules: `kernel/boolean.bend`.

```python
law coaxial_insert_length:
  for +v: R.Real
  for +sorted: List<&2, R.Real>
  {Spec.grows_by_at_most_one(List.length(&2, R.Real, B.insert(v, sorted)), List.length(&2, R.Real, sorted)) == True{} : Bool}
```

- **Value:** B.insert also deduplicates (R.equal); the length grows by 0 or 1 and no value other than v appears.
- **Provability:** class A; Bool generalization.
- **Effort:** XS. Two-branch induction.

#### SRT-04 `sorted_after_insert` (class C, effort S)

Modules: `(all insertion sorts)`.

```python
# conditional form, only if erased order hypotheses are usable (open spike question):
law insert_event_sorted:
  for +event: FP.BoundaryEvent
  for +sorted: List<&2, FP.BoundaryEvent>
  for -order: Spec.StrictTotal(FP.event_parameter)
  for h: {Spec.sorted(sorted) == True{} : Bool}
  {Spec.sorted(FP.insert_event(event, sorted)) == True{} : Bool}
```

- **Value:** Sortedness depends on R.less being a strict total order, which the logic cannot know (F32 is postulated).
- **Provability:** class C; conditional on comparator axioms, otherwise run time.
- **Effort:** S. If order axioms can be passed as erased hypotheses the proof is standard; otherwise out of reach.
- **Covered instead by:** Run time: an O(n) sortedness check after each sort, in Bend (truck already checks strict gaps via root_gaps). Differential: compare against a JS sort of the decoded parameters in tests.

#### SRT-05 `sorted_events_filters_support` (class A, effort S)

Modules: `kernel/face-plane.bend`.

```python
law sorted_events_count:
  for +events: List<&2, FP.BoundaryEvent>
  for +index: U32
  {List.length(&2, FP.BoundaryEvent, FP.sorted_events(events, index)) == Spec.count_support(events, index) : Nat}
```

- **Value:** Every event of a support is kept exactly once; span parity depends on it (odd counts are rejected as OddEvents).
- **Provability:** class A; Bool generalization over U32.is_eq(support, index) plus SRT-01.
- **Effort:** S. One induction.

#### SRT-06 `unique_ids_spec` (class B, effort M)

Modules: `kernel/ports/solvespace.bend`.

```python
law unique_ids_complete:
  for +ids: List<&2, U32>
  for +i: U32
  for h: {Sv.id_present(ids, i) == True{} : Bool}
  {Sv.id_present(Sv.unique_ids(ids, Nil{}), i) == True{} : Bool}

law unique_ids_distinct:
  for +ids: List<&2, U32>
  {Spec.no_duplicates(Sv.unique_ids(ids, Nil{})) == True{} : Bool}
```

- **Value:** Split events per edge are deduplicated without losing any.
- **Provability:** class B; Lib.u32 is_eq refl/sym/sound.
- **Effort:** M. Accumulator-style dedup with U32 equality.

#### SRT-08 `reversals_involutive` (class A, effort XS)

Modules: `kernel/topology.bend`, `kernel/sketch-lines.bend`, `kernel/sketch-arcs.bend`, `kernel/ports/planar-boolean-arrangement.bend`, `kernel/ports/truck-topology.bend`.

```python
law arrangement_reverse_involutive:
  for +xs: List<&2, U32>
  {D.reverse(D.reverse(xs, Nil{}), Nil{}) == xs : List<&2, U32>}
```

- **Value:** Five reversal helpers orient rings and caps: involution plus length preservation.
- **Provability:** class A; accumulator lemma.
- **Effort:** XS. Standard; one per helper.

#### SRT-09 `take_drop_append` (class A, effort XS)

Modules: `(Base List)`.

```python
law take_drop_append:
  for +xs: List<&2, D.Cell>
  for +n: Nat
  {List.append(&2, D.Cell, List.take(&2, D.Cell, xs, n), List.drop(&2, D.Cell, xs, n)) == xs : List<&2, D.Cell>}
```

- **Value:** Lemma for BOO-10: the halving split neither loses nor duplicates cells. Bugs: 70ac0f4 (planar selection rewritten from a fold into a halving parallel split, claimed bit-identical).
- **Provability:** class A; induction.
- **Effort:** XS. Proven in smoke3.bend (xs must precede n: matches follow binder order).

#### SRT-11 `section_root_dedup` (class B, effort M)

Modules: `kernel/section.bend`.

```python
law find_root_after_append:
  for +roots: List<&2, Sec.Root>
  for +edge: U32
  for +hit: E.EdgeHit
  for +source: E.EdgeSource
  for h: {Sec.find_root(roots, edge, hit, 0) == Sec.MissingRoot{} : Sec.RootLookup}
  {Sec.find_root(List.append(&2, Sec.Root, roots, [Sec.SourceRoot{edge, hit, source}]), edge, hit, 0) == Sec.FoundRoot{U32.from_nat(List.length(&2, Sec.Root, roots))} : Sec.RootLookup}
```

- **Value:** An intersection root is created once and found again by its (edge, word-identical parameter) key, so two faces meeting at a root share one vertex; a duplicate root would leave a T-junction or an unpaired edge.
- **Provability:** class B; EXA-18 plus Lib.u32 add_one_is_inc.
- **Effort:** M. Index accumulator in U32 plus same_real/same_point reflexivity.

#### TES-01 `ring_length_and_clamp` (class B, effort S)

Modules: `kernel/tessellate.bend`.

```python
law ring_length:
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  for +radius: R.Real
  for +count: U32
  {List.length(&2, PG.Vec3, Ts.ring(o, axis, x, radius, count)) == U32.to_nat(count) : Nat}

law estimate_clamped:
  for +radius: R.Real
  for +deviation: R.Real
  {Spec.u32_between(Ts.estimate(radius, deviation), 3, 8192) == True{} : Bool}
```

- **Value:** Every ring has exactly count samples (watertightness relies on both faces sampling the same count), and the estimate is clamped to [3, 8192] whatever the F32 value is. Bugs: c50077b (print mesh: separate samplers divided shared circles differently (up to 184 unpaired edges)).
- **Provability:** class B; ring: induction on remaining (class A); clamp: Lib.u32 order lemmas.
- **Effort:** S. The ring length is XS; the clamp needs lt/le transitivity on U32.

#### SKL-01 `source_point_identity_equivalence` (class B, effort S)

Modules: `kernel/sketch-lines.bend`.

```python
law source_equal_refl:
  for +p: SL.SourcePoint
  {SL.source_equal(p, p) == True{} : Bool}

law source_equal_sym:
  for +a: SL.SourcePoint
  for +b: SL.SourcePoint
  {SL.source_equal(a, b) == SL.source_equal(b, a) : Bool}
```

- **Value:** Sketch vertex identity (binary64 words, +0 = -0) is an equivalence, so walks and degree counts cannot disagree about which endpoints coincide. point_equal also uses R.equal and is not provable (NaN), but point_valid rejects NaN first.
- **Provability:** class B; Lib.u32 is_eq lemmas.
- **Effort:** S. Word lemmas plus Bool algebra; transitivity needs the +-0 case split.

### 5.7 Floating-point geometry (class C)

| ID | Law | Class | Effort | Status | Prio |
|---|---|---|---|---|---:|
| GEO-02 | `frames_orthonormal` | C | - | runtime | 2 |
| GEO-03 | `transform_is_proper` | C | - | runtime | 1 |
| GEO-04 | `faces_point_outward` | C | - | runtime | 1 |
| GEO-05 | `claimed_volume_is_measured` | C | - | runtime | 1 |
| GEO-06 | `tessellation_deviation` | C | - | runtime | 2 |
| GEO-07 | `bounds_conservative` | C | - | runtime | 2 |
| GEO-08 | `roots_and_intersections` | C | - | runtime | 2 |
| GEO-10 | `revolve_profile_simple_ccw` | C | - | runtime | 2 |

#### GEO-02 `frames_orthonormal` (class C, effort -)

Modules: `kernel/analytic.bend`, `kernel/geometry.bend`, `kernel/precise.bend`.

```python
# informal: normalize/frame/axis_x produce unit, perpendicular axes
```

- **Value:** Every surface frame.
- **Provability:** class C; not provable.
- **Effort:** -. F32.
- **Covered instead by:** validateAnalytic (src/analytic.mjs) checks unit and perpendicular frames per body; STEP validation. Propose moving the frame audit into Bend (curved-validate already holds part of it).

#### GEO-03 `transform_is_proper` (class C, effort -)

Modules: `kernel/topology.bend`, `kernel/analytic.bend`.

```python
# informal: det(rotation) = +1; otherwise every face turns inside out while TOP-03 still holds
```

- **Value:** Winding under transforms.
- **Provability:** class C; not provable.
- **Effort:** -. F32.
- **Covered instead by:** Host guard in src/queries.mjs opPattern (unit rows, orthogonal, det = 1). Propose the same guard inside Bend (A.transform/T.transform returning a refusal) so a new frontend cannot skip it (PR-7).

#### GEO-04 `faces_point_outward` (class C, effort -)

Modules: `kernel/pierce.bend`, `kernel/revolve.bend`, `kernel/topology.bend`, `kernel/ports/*`.

```python
# informal: every face normal (with same_sense) points out of the material
```

- **Value:** The orientation half of 08463e5, 9467cfb (clockwise profile) and 5d4af78. Bugs: 08463e5 (pierce: inner-loop direction keyed on same_sense gave a doubled edge use on planar bodies; a blind tool cut a full through hole); 9467cfb (revolve: supported() was a predicate nothing called; a 2-point profile built coincident planes that validated; clockwise profiles and ulp-thin segments were accepted); 5d4af78 (print mesh: cone orientation guard inert (NaN); undirected pairing accepted a face turned inside out).
- **Provability:** class C; not provable.
- **Effort:** -. Depends on F32 decisions.
- **Covered instead by:** Directed-edge pairing (TOP laws plus validateAnalytic), positive measured volume in H.valid, planar orientations in CV.audit, the directed-edge check in the print mesh and validate-print-mesh.py (trimesh winding). OCCT does NOT confirm winding (9467cfb). Propose that every constructor runs S.edges_closed, CT.valid and a signed-volume check in Bend before returning (PR-7).

#### GEO-05 `claimed_volume_is_measured` (class C, effort -)

Modules: `kernel/pierce.bend`, `kernel/revolve.bend`, `kernel/boolean.bend`.

```python
# informal: the reported volume equals the boundary integral of the produced body
```

- **Value:** 1d73cd1 reported the same removed volume for a hole a metre away; 8b21014 negated the Pappus volume. Bugs: 1d73cd1 (pierce: a hole far outside the outline was admitted with an invented wall; the volume came from the recorded volume and was never integrated); 8b21014 (revolve: loops ordered by height gave a disconnected boundary, then edges used twice in one direction; the Pappus volume came out negated).
- **Provability:** class C; not provable.
- **Effort:** -. F32 integrals.
- **Covered instead by:** Run time: compare formula volumes (pierced_volume, Rv.volume, B.volume) with ports/curved-metrics.bend volume() of the produced solid within a stated tolerance. Differential: OCCT volume in validate-step.py.

#### GEO-06 `tessellation_deviation` (class C, effort -)

Modules: `kernel/tessellate.bend`.

```python
# informal: sagitta(radius, chord_count(radius, d)) <= d
```

- **Value:** The print-mesh promise. Bugs: c50077b (print mesh: separate samplers divided shared circles differently (up to 184 unpaired edges)).
- **Provability:** class C; not provable.
- **Effort:** -. F32 trigonometry.
- **Covered instead by:** Ts.within is re-checked by the host (src/print-mesh.mjs) and refused otherwise; validate-print-mesh.py bounds the volume deviation independently. Propose returning Maybe from chord_count so the check lives in Bend (refine() returns an unverified count when its 64 steps run out).

#### GEO-07 `bounds_conservative` (class C, effort -)

Modules: `kernel/face-bounds.bend`, `kernel/boolean.bend`, `kernel/analytic.bend`.

```python
# informal: every point of the face lies within the returned directional bounds
```

- **Value:** Exclusion filters and retention.
- **Provability:** class C; not provable.
- **Effort:** -. F32.
- **Covered instead by:** Differential sampling test: sample trimmed faces densely and assert containment with margin; existing face-bounds tests.

#### GEO-08 `roots_and_intersections` (class C, effort -)

Modules: `kernel/ray.bend`, `kernel/curve-plane.bend`, `kernel/edge-plane.bend`, `kernel/intersections.bend`, `kernel/face-plane.bend`.

```python
# informal: resolved hits are the true roots within the stated resolution
```

- **Value:** Inputs of sections and classification.
- **Provability:** class C; not provable.
- **Effort:** -. F32.
- **Covered instead by:** Oracle tests per module (ray, curve-plane, edge-plane, intersections, face-plane); explicit Unresolved kinds are part of the contract.

#### GEO-10 `revolve_profile_simple_ccw` (class C, effort -)

Modules: `kernel/revolve.bend`.

```python
# informal: admitted profiles are simple and counterclockwise
```

- **Value:** Known gap in revolve.bend: a self-crossing profile with positive net area is accepted. Bugs: 9467cfb (revolve: supported() was a predicate nothing called; a 2-point profile built coincident planes that validated; clockwise profiles and ulp-thin segments were accepted).
- **Provability:** class C; not provable.
- **Effort:** -. F32.
- **Covered instead by:** Run time: pairwise segment intersection (with the collinear-overlap case) in admission. Differential: OCCT BRepCheck on the export.

## 6. Fragile spots found while mapping

These are not reported as bugs: each one is adequate as called today. They are places where a failure would stay
silent, and where a law or a small refactor would make it impossible or loud.

1. **Sentinel indices plus default geometry.** Several lookups return `4294967295` when they miss:
   `boolean.index_of`, `halfspace.mapped`, `truck-topology.lookup`, `solvespace.edge_index`,
   `curved-edges.id` (used by `mapped`), and `owner_or` in planar-boolean-provenance
   (`FaceRef{4294967295, 4294967295}`). The same number also appears as a deliberate "no index" marker in
   error records and synthetic keys (`step-cylinder-pcurves.no_index`, curved-contact); those are not lookups.
   Downstream, `halfspace.point(None)` yields `(0,0,0)`, `halfspace.edge(None)` a line edge 0 -> 0, and `analytic.edge_at`/`vertex_at` a default edge or
   point. A missed lookup therefore becomes a well-formed wrong entity, not an error. Covered by TOP-24, TOP-25
   and PR-4.
2. **Fuel that truncates silently.** `boolean.components` and `truck-topology.components` return `Nil`,
   `truck-topology.grow` stops growing, and `planar-boolean-selection.select` at fuel 0 classifies only the head
   cell. Other fuel sites already fail explicitly: `boundary` (`WalkLimit`), the ports' component splitters
   (`valid = False`), `solvespace-bsp` (`Bad`), `cyclic`/`boundary` in the selection. `tessellate.refine` returns
   an unverified count after 64 steps; the host re-checks `within()`.
3. **U32 op code.** In `boolean.selected`, every code other than 0 and 1 means difference. See BOO-05 and PR-5.
4. **Guards that live only in JS.** The proper-rotation check (`src/queries.mjs` opPattern), directed pairing,
   loop closure and frame checks for analytic bodies (`validateAnalytic`), the `within()` re-check
   (`src/print-mesh.mjs`), and Euler-Poincare with inner loops (only in individual tests). A new frontend or the
   native binding bypasses all of them. See PR-7.
5. **Unvalidated constructor output.** `pierce` returns `Bored{bore(..)}` and `revolve` returns
   `Swept{shell(..)}` without any Bend-side check of the constructed shell. Validation happens only in JS
   (`decodeAnalytic` -> `validateAnalytic`).
6. **Halfspace publishes a canonicalized body.** It validates `solid` and returns `canonical(solid)`, with frames
   recomputed. The topology is unchanged (TOP-28); the frames are class C.
7. **The wire codec's F32 leaf** is `F32.bits(x)`, a postulate, which makes every generated round trip
   unprovable. The decoder already re-wraps structurally (`U32{w} = x; F32{w}`). See WIR-04 and PR-6.
8. **Parallel lists** (edges/domains/origins/blocks in edge tables and results) stay aligned only by convention.
   See ALN-01.
9. **Identity arrays index B-rep arrays by position** (topology-identity.md). Counts must match exactly. See
   TOP-05 and IDN-06.

## 7. Class C at a glance

| ID | Claim (informal) | Run-time check today | Differential / independent check | Gap or proposal |
|---|---|---|---|---|
| EXA-14 | `from_word` equals the IEEE value | none | BigInt oracle in `test/robust-predicates.test.mjs` | exhaustive exponent sweep |
| EXA-15 | float filter sign = exact sign | fallback to exact below the bound | BigInt oracle (indirect) | explicit filter-vs-exact differential test |
| EXA-16 | F32x2 ops are error-free and normalized | none | binary64 oracle in `test/real.test.mjs` | BigInt rational oracle on raw words |
| BOO-19 | classification is geometrically right | 5-ray agreement, boundary short-circuit | bakeoff vs OCCT and Manifold, public regressions | keep |
| BOO-20 | pierce hole lies in material | parity admission (decline 7) | OCCT solid count, bakeoff | volume cross-check (GEO-05) |
| GEO-02 | frames orthonormal | `validateAnalytic` (JS) | STEP validation | move the audit into Bend |
| GEO-03 | transforms are proper rotations | `opPattern` guard (JS) | none | guard inside Bend (PR-7) |
| GEO-04 | faces point outward | `H.valid` volume > 0, `CV.audit`, print-mesh directed edges | trimesh winding; OCCT does not check winding | constructors gate themselves (PR-7) |
| GEO-05 | reported volume = produced volume | none for pierce/revolve | OCCT volume | compare with `curved-metrics.volume` at run time |
| GEO-06 | tessellation deviation holds | host re-checks `within()` | `validate-print-mesh.py` | `chord_count` returns Maybe (PR-7) |
| GEO-07 | bounds are conservative | none | face-bounds tests | dense sampling test |
| GEO-08 | resolved roots are true roots | explicit Unresolved kinds | per-module oracle tests | keep |
| GEO-10 | revolve profiles are simple and CCW | signed volume (CCW only) | OCCT BRepCheck | pairwise segment test (known gap) |
| SRT-04 | sorts are sorted | `root_gaps` in truck only | none | O(n) sortedness check after each sort |
| WIR-06 | JS and C codecs agree | malformed frames rejected | wire and binding tests | keep |

## 8. Proposals (as diffs; production files are read-only for this role)

### PR-1: law library layout and gate

```text
kernel/laws/
  lib/list.bend     length_append (probed), append_assoc, take_drop_append, reverse lemmas
  lib/perm.bend     Perm relation, insert/partition/filter lemmas
  lib/u32.bend      is_eq_refl (probed), is_eq_sound, is_eq_sym, cmp_antisym, add_assoc,
                    add_one_is_inc, from_nat_add, to_nat_from_nat (< 2^32), from_nat_injective
  spec.bend         Spec.* reference helpers (pairing, loop closure, euler_holds, skeletons, counts, value)
  topology.bend     TOP-*/ALN-* lemmas      exact.bend     EXA-*
  boolean.bend      BOO-*                   identity.bend  IDN-*
  generated/        instance laws (TOP-06/07/10 for n = 3..32, TOP-19/20 per cell set),
                    written by a script under scripts/laws/
```

Each lemma file is self-contained (`law` plus `def` in one file, as Base does). `LAWS.bend` stays Marc's short
list of claims. `PROOF.bend` imports `LAWS.bend` and the lemma files, and each `def Laws.x` applies the matching
lemma. Generated instance laws are evidence, not specification: they belong in the gate through `PROOF.bend`'s
imports, but not in `LAWS.bend`.

**Helpers used inside a claim are part of the specification.** If a law in `LAWS.bend` says
`Spec.t_edges_paired(..) == True{}` and an agent may edit `Spec.t_edges_paired`, the agent can weaken the law
(for example by making the helper return `True{}`) without touching `LAWS.bend`. Helpers that appear in claims
(projections, pairing and loop-closure checks, `euler_holds`, `canonical`, `value`, `Perm`) therefore belong in
`LAWS.bend` itself, or in a file under the same human-only rule. Only lemmas and proofs go under `kernel/laws/`.
The same caution applies to the kernel's own checkers used as specifications (`S.edges_closed`, `CT.valid`); see
TOP-21/22.

Wording that Marc could paste into `LAWS.bend` for wave 1 (statements from the catalogue; `LAWS.bend` would need
the imports shown, and the two projection helpers move into it):

```python
import ./kernel/precise.bend as PG
import ./kernel/real.bend as R
import ./kernel/analytic.bend as A
import ./kernel/revolve.bend as Revolve
import ./kernel/solid-classification.bend as SolidClassification
import ./kernel/halfspace.bend as Halfspace
import ./kernel/ports/planar-boolean-selection.bend as Selection

def a_edges(s: A.Solid) -> List<&2, A.Edge>:
  A.Solid{_, edges, _} = s
  edges

def a_faces(s: A.Solid) -> List<&2, A.Face>:
  A.Solid{_, _, faces} = s
  faces

# Gates and refusals: a result exists only after its admission.
law revolve_refuses_two_points:
  for +ra: R.Real
  for +ha: R.Real
  for +rb: R.Real
  for +hb: R.Real
  for +t: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {Revolve.revolve([Revolve.Ring{ra, ha}, Revolve.Ring{rb, hb}], t, o, axis, x) == Revolve.Refused{1} : Revolve.Revolved}

# Shells: every frustum is a paired shell, for all geometry.
law frustum_edges_closed:
  for +bottom: PG.Vec3
  for +top: PG.Vec3
  for +x: PG.Vec3
  for +r0: R.Real
  for +r1: R.Real
  {SolidClassification.edges_closed(a_edges(A.frustum(bottom, top, x, r0, r1)), a_faces(A.frustum(bottom, top, x, r0, r1)), 0) == True{} : Bool}

# Selection: the planar Boolean uses boolean.bend's truth table.
law planar_choose_subtraction:
  for +ai: Bool
  for +bi: Bool
  for +polys: List<&2, Halfspace.Polygon>
  for +before: List<&2, Halfspace.Polygon>
  for +count: U32
  for +index: U32
  {Selection.choose(Selection.Membership{True{}, ai}, Selection.Membership{True{}, bi}, polys, Selection.Selection{before, count}, index, True{})
    == Selection.Selection{Bool.pick(List<&2, Halfspace.Polygon>, B.selected(2, ai, bi), List.append(&2, Halfspace.Polygon, before, polys), before),
      (count + Bool.pick(U32, B.selected(2, ai, bi), 1, 0) : U32)} : Selection.Selection}
```

### PR-4: Maybe instead of sentinels (sketch for `kernel/halfspace.bend`)

```diff
-def mapped(map: List<&2, VertexMap>, +index: U32) -> U32:
+def mapped(map: List<&2, VertexMap>, +index: U32) -> Maybe<&2, U32>:
   match map:
     case Nil{}:
-      4294967295
+      None{}
     case VertexMap{before, after} <> tail:
-      Bool.pick(U32, U32.is_eq(before, index), after, mapped(tail, index))
+      Bool.pick(Maybe<&2, U32>, U32.is_eq(before, index), Some{after}, mapped(tail, index))
```

`remap_edges` then returns `Maybe<&2, List<&2, A.Edge>>`, and `compact_solid`/`capped` map `None` to
`Unresolved{InvalidClipResult{}}`. The same pattern applies to `boolean.index_of`, `truck-topology.lookup`,
`solvespace`, `curved-edges` and the provenance fallback. `point(None)`/`edge(None)` should disappear from paths
that construct geometry. After this change TOP-24/25 shrink to "no `None` for a referenced index", which is
provable with far less index arithmetic.

### PR-5: the Boolean operation as an ADT (`kernel/boolean.bend`)

```diff
-def selected(+op: U32, +a: Bool, +b: Bool) -> Bool:
-  Bool.pick(Bool, U32.is_eq(op, 0), Bool.or(a, b),
-    Bool.pick(Bool, U32.is_eq(op, 1), Bool.and(a, b), Bool.and(a, Bool.not(b))))
+type Op is Data:
+  Union{}
+  Intersection{}
+  Difference{}
+
+def selected(+op: Op, +a: Bool, +b: Bool) -> Bool:
+  match op:
+    case Union{}:
+      Bool.or(a, b)
+    case Intersection{}:
+      Bool.and(a, b)
+    case Difference{}:
+      Bool.and(a, Bool.not(b))
```

`radial_cells`, `cells` and `coaxial` take `Op`; `enclosed_void` tests `Difference{}`. `src/boolean.mjs` maps its
codes explicitly and refuses unknown ones. This rewrites two laws in `LAWS.bend` (`B.selected(0, ..)` becomes
`B.selected(B.Union{}, ..)`), so it is Marc's decision.

### PR-6: wire generator (`scripts/native-bridge/gen-wire.mjs`, emitted Bend)

```diff
     `def enc_F32(x: F32, rest: ${W}) -> ${W}:`,
-    '  F32.bits(x) <> rest',
+    '  F32{w} = x',
+    '  U32{w} <> rest',
```

The decoder already does the inverse (`f32_of_bits`: `U32{w} = x; F32{w}`), so the emitted C/JS keeps the raw
bits. Before switching, confirm with the existing wire tests that the compiled code is bit-identical. The generator
should also emit `law wire_<T>_roundtrip` with a mechanical proof (constructor case split, field lemmas) for every
generated type (WIR-01).

### PR-7: constructors gate their own output (`kernel/pierce.bend`, similarly `kernel/revolve.bend`)

```diff
+import ./solid-classification.bend as S
 ...
 def admitted(ok: Bool, +reason: U32, target: A.Solid, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real, +tolerance: R.Real) -> Pierced:
   match ok:
     case True{}:
-      Bored{bore(target, origin, axis, radius, tolerance)}
+      checked_bore(bore(target, origin, axis, radius, tolerance))
     case False{}:
       Declined{reason}
+
+# Decline code 9: the constructed shell is not paired. Never expected; it turns a
+# construction defect into a refusal instead of a body the host has to catch.
+def checked_bore(+solid: A.Solid) -> Pierced:
+  A.Solid{_, +edges, +faces} = solid
+  Bool.pick(Pierced, S.edges_closed(edges, faces, 0), Bored{solid}, Declined{9})
```

`CT.valid` would be the natural second check, but it lives in `kernel/ports/` and depends on halfspace. Moving the
vertex-link check into `kernel/` avoids a kernel -> ports import. Importing solid-classification pulls the
classifiers into pierce's closure, which costs compile time; a leaner option is a small `kernel/shell-audit.bend`
holding `edges_closed` and the vertex-link check, which the laws in TOP-21/22 would then be about. In the same
change, `A.transform`/`T.transform` should refuse rotations that are not proper (GEO-03), and
`tessellate.chord_count` should return `Maybe` when `refine` runs out of steps (GEO-06).

### PR-8: exact integers over Nat digits (needs a performance spike)

`robust-predicates.Big` stores `List<&2, U32>` digits in base 4096. At run time Nat is a native immediate up to
2^48 and fails loudly on overflow instead of wrapping. Rewritten over Nat digits, `mag_add`/`mag_sub`/`mag_mul`
become class A (Nat.divmod facts instead of Word bit lemmas): EXA-11 drops from L to M and EXA-12 from XL to L.
The digit type is private to the module, so only `from_word` (which decodes F32.bits into digits) and the tests
change. This is only worth doing if a benchmark shows no regression in `point_plane`/`indirect_values`.

### PR-3 (optional): Nat skeletons for index-generating constructors

Compute edge and use indices as Nat in `topology.extrude`, `revolve.shell` and `pierce.bore`, and convert with
`U32.from_nat` when an `Edge`/`Use` is built. Generic pairing laws then become class A. However, Base defines
`U32.from_nat` by recursion, so each conversion may cost O(n) at run time. The lemma-library route (EXA-19:
`add_one_is_inc` and `from_nat_add` show that the existing U32 counters equal `from_nat` of a Nat counter) proves
the same laws without touching production code, so it is the preferred path.

## 9. Recommended order

**Wave 1 (1-2 days, class A and B-literal).** Move the probe-proven laws into `kernel/laws/` and offer them for
`LAWS.bend`: TOP-03, TOP-05 (vertices, then edges and faces), TOP-08, TOP-09, TOP-10 and TOP-11 instances
(n = 3..16), TOP-12, TOP-17, BOO-06, BOO-07, BOO-11 (monotone half), BOO-13, BOO-15, BOO-16, BOO-17, EXA-01,
EXA-02, EXA-13, EXA-17, IDN-02, IDN-07, SRT-09. Add TOP-27 (every body the planar Boolean publishes passed
`CT.valid`), which is class A, M effort, and the highest-value new law. The total checker cost stays around a few
seconds.

**Wave 2 (3-5 days, lemma library).** `Lib.list`, `Lib.perm`, `Lib.u32`. Then TOP-06/07 (instances, then
generic), TOP-11, TOP-13, TOP-14, TOP-18, TOP-21, TOP-28, ALN-01, EXA-04 to EXA-09, BOO-09, BOO-10, SRT-01,
IDN-03, IDN-05, IDN-06.

**Wave 3 (pick by pain).** TOP-23 (stitch soundness), TOP-24/25 (after PR-4), TOP-19/20 (the exhaustive coaxial
Boolean), TOP-29 (port gates), EXA-10/11 (or PR-8 first), IDN-01 (framing injectivity), WIR-01 to WIR-05 (after
PR-6).

**Not planned.** EXA-12 and IDN-10. Every class C claim stays with run-time checks.

**Parallel run-time track for class C.** PR-7 (constructors gate themselves, proper rotations), a volume
cross-check after pierce/revolve/coaxial (GEO-05), a BigInt oracle for F32x2 (EXA-16), a filter-vs-exact
differential test (EXA-15), and sortedness assertions after sorts (SRT-04).

## 10. Limits of this inventory

- Effort estimates extrapolate from probes of 1 to 13 laws per file. Among class-B-generic lemmas, only
  `u32_eq_refl` was tried. The arithmetic bridges (`from_nat_add`, `to_nat` bounds, `and`/`shrn`) were not; the
  spike owns those numbers.
- Instance laws prove fixed sizes only (n = 3..32). They are bounded verification, not a statement for all n.
- Several topology laws use the kernel's own checkers (`S.edges_closed`, `CT.valid`) as the specification.
  TOP-21 and TOP-22 are what make that trustworthy. Until they exist, a law like TOP-08 says "the gate accepts
  every frustum", which is weaker than "every frustum is a closed 2-manifold".
- A law about a Bend function says nothing about code that bypasses it, such as JS assembling a body directly.
  Gate laws are per entry point.
- A claim is only as strong as the helpers it calls. `Spec.*` helpers that appear in `LAWS.bend` must be
  human-owned (PR-1); otherwise the "AI does not touch LAWS.bend" convention can be sidestepped.
- Proofs reason about Base's `Word(32n)` model of U32; the runtimes implement U32 natively with wraparound. That
  correspondence is part of Bend's trusted base, not something the laws check.
- Module summaries for the larger modules (face-plane, junction, section, the ports) come from their headers,
  types and the functions named here, not from a line-by-line reading.
- Nothing in `kernel/`, `src/`, `LAWS.bend` or `PROOF.bend` was changed. All probe files are standalone and live
  in `tmp/laws/inventory/`.

## 11. Files

- `docs/laws/inventory.md`: this document.
- `out/laws/candidates.json`: the same modules, candidates, probes and proposals, machine-readable.
- `tmp/laws/inventory/`: `data.mjs`, `modules.mjs`, `head.md` and `tail.md` (sources), `build.mjs` (regenerates
  both outputs: `node tmp/laws/inventory/build.mjs`), and the probe files `smoke.bend`, `smoke2.bend`,
  `smoke3.bend`, `instances.bend`, `revolve{8,16,32}.bend`, `u32-refl.bend`, `negative.bend`, `negative2.bend` with their logs.
