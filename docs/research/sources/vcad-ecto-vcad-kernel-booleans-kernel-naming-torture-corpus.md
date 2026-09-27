# vcad (ecto/vcad): kernel-booleans, kernel-naming, torture corpus

- Kind: open-source Rust monorepo (web/desktop/CLI/MCP parametric CAD) with its own B-rep kernel. Repo https://github.com/ecto/vcad, site https://vcad.io. Read at commit `eba7a2e6a89ff06801776fbc599d5c8a64036168` (2026-09-17), sparse clone of `crates/` + `docs/` in `tmp/research/vcad-ecto-vcad-kernel-booleans-kernel-naming-torture-corpus/repo`.
- Authors / years: Municipal Robotics Corporation (NOTICE: "Copyright 2026 Municipal Robotics Corporation"), repo created 2026-01-27, last commit on `main` 2026-09-17, last push 2026-09-23 (dependabot branches) (`gh api repos/ecto/vcad`). Many issues and code comments carry "Filed by / Generated with Claude Code" footers (e.g. https://github.com/ecto/vcad/issues/895, https://github.com/ecto/vcad/issues/893), so a large share of the kernel is agent-written (DOCUMENTED for the issues, INFERRED for the code).
- License: `LICENSE` is Apache-2.0 and NOTICE says Apache-2.0 (DOCUMENTED, https://github.com/ecto/vcad/blob/main/LICENSE), but the workspace `Cargo.toml` declares `license = "MIT"` (DOCUMENTED, line 206). Mismatch; treat as Apache-2.0 (the stricter reading: NOTICE retention, patent clause). Porting implication: ideas are free; transliterated code into a private unlicensed repo would need the NOTICE and license text kept, so study-and-rewrite only. Never link (wonky rule).
- Status / activity: very active. 427 stars on 2026-09-24 (not ~2.3k as the brief suggested). The 2.3k is the commit count: 2,276 commits on `main`. Contributors: `ecto` 1,870 commits, the `claude` account 215, `claude[bot]` 9, plus bots. There are 25 forks and 117 open issues, including dependabot PRs. The only tagged release is v0.9.4 (2026-04-29). The repo is about 688 MB and has 94 crates (`ls crates | wc -l`). (All DOCUMENTED via `gh api` on 2026-09-24.) Most of the crates cover unrelated domains (EM, QCD, neutronics, thermal, commerce). Kernel-relevant crates by line count: `vcad-kernel-booleans` 28 341 (split.rs 6 279, cyl_band.rs 2 251, lib.rs 2 015, classify.rs 1 833, pipeline.rs 1 663, trim.rs 1 458, api.rs 1 397, ssi.rs 1 311, mesh/csg.rs 966), `vcad-kernel-naming` 801, `vcad-torture` 2 542, `vcad-kernel-fillet` 5 822, `vcad-kernel-tolerance` 6 998. Maturity: young (8 months), production-facing, fast-moving, with honest self-measurement.

## What it is

A double-precision B-rep kernel for analytic primitives (plane, cylinder, cone, sphere, torus) with a Boolean pipeline that is explicitly two-tier: an "analytic" B-rep Boolean, and a mesh-CSG fallback whose triangle soup is re-wrapped as a B-rep and labelled `TriangleSoup`. Around it sit three pieces that matter for wonky more than the Boolean itself:

1. A **fidelity contract**: every Boolean returns a report saying whether the result is analytic or soup and why (DOCUMENTED, https://github.com/ecto/vcad/blob/main/crates/vcad-kernel-booleans/src/api.rs, https://github.com/ecto/vcad/blob/main/docs/boolean-fidelity-matrix.md).
2. A **fail-closed persistent naming** crate (`cube:top.0`, edge = pair of face names, `Resolved | Ambiguous | Lost`) (DOCUMENTED, https://github.com/ecto/vcad/blob/main/crates/vcad-kernel-naming/src/lib.rs, https://github.com/ecto/vcad/blob/main/docs/topo-naming-m0.md).
3. A **752-case deterministic torture corpus** with a five-class grading scheme and a CI baseline that fails on any per-case regression (DOCUMENTED, https://github.com/ecto/vcad/blob/main/docs/torture-track.md, https://github.com/ecto/vcad/blob/main/crates/vcad-torture/src/lib.rs).

`docs/trust-boundary.md` turned out to be about the MCP commerce plane (spend authorization, prompt-injection confinement), not about geometry. Irrelevant for the kernel (DOCUMENTED, https://github.com/ecto/vcad/blob/main/docs/trust-boundary.md).

## How it works

### Boolean pipeline (crate `vcad-kernel-booleans`)

Stages (DOCUMENTED, module docs in `lib.rs`, `pipeline.rs`, `classify.rs`, `sew.rs`):

1. AABB broadphase over face pairs (`bbox.rs`). Disjoint AABBs short-circuit.
2. **Freeze** (`freeze.rs`): every analytic full-circle edge of both operands is rewritten into a canonical polyline *before* the pipeline runs, because "A result that mixes the two is watertight only by resolution coincidence ... its topology can never conform, which is exactly what poisons any further boolean taken on the result". So the "analytic B-rep" keeps analytic *surfaces* but its edges are polylines (DOCUMENTED, https://github.com/ecto/vcad/blob/main/crates/vcad-kernel-booleans/src/freeze.rs).
3. The polylines come from `split::canonical_arc_points`: a per-circle global angular lattice. The normal is sign-canonicalized, the in-plane x axis is the world axis least parallel to the normal, grid angles are `k * 2π/n`, and arcs emit only the lattice points strictly inside their span. Two faces that share a circle therefore emit identical seam vertices (DOCUMENTED, `split.rs` around line 4942). This is the same trick as Fornjot's `CircleApprox` lattice. Two independent projects converged on it.
4. SSI (`ssi.rs`): closed forms for plane×{plane, sphere, cylinder, cone, torus}, sphere×sphere, and cylinder×cylinder only when the axes are perpendicular, intersect, and the radii are equal. Everything else goes to a marching sampler that returns "loose point dust" (DOCUMENTED, `unrepresentable.rs::pair_is_analytic`). SSI over candidate pairs runs `pairs.par_iter().map(compute_ssi)` under rayon (DOCUMENTED, `pipeline.rs:1320`).
5. Trim the curves to the face domains (`trim.rs`, Shewchuk `orient2d` for point-in-polygon), then split the faces. Oblique cylinder cuts use a **v-band** representation `{u ∈ [u0,u1], lo(u) ≤ v ≤ hi(u)}` whose two chains own independent vertex lists and are sliced verbatim, never resampled, so shared rims keep their neighbors' vertex sets (DOCUMENTED, `cyl_band.rs` header: "The former paired-column representation interpolated each chain onto the union grid, which invented rim vertices the neighboring face never had — a guaranteed seam crack").
6. Classify sub-faces as IN / OUT / ON_SAME / ON_OPPOSITE by ray casting (`classify.rs`), sew (`sew.rs`, vertex merge within tolerance), then topology repair (`repair.rs`: collapse zero-length half-edges, remove A-B-A spikes, pair orphan half-edges).
7. No-crossing fast path (`no_crossing.rs`): if SSI produced zero real crossings and no coincident-region contact, containment is resolved with two point-in-solid queries. "Every ambiguity resolves toward the slow, general path" (DOCUMENTED).

### Up-front unrepresentability declaration

`arrangement_is_unrepresentable` (DOCUMENTED, https://github.com/ecto/vcad/blob/main/crates/vcad-kernel-booleans/src/unrepresentable.rs): for every broadphase pair whose surface pair is *not* analytic, sample up to 24 loop vertices and edge midpoints per face. Each sample is probed at ±skin along x and y against the other operand's tessellation (`point_in_mesh`). All four probes inside counts as inside, zero counts as outside, and anything else is ignored. `skin = clamp(diag·1e-3, 1e-4, 0.5)`. If any face has both inside and outside samples, the pair "genuinely crosses", and the whole Boolean goes to the mesh fallback before the B-rep pipeline runs. The motivating failure: "a Ø20 cylinder bored through a Ø60 sphere came back as an untouched sphere, and a cross-drilled bar came back with the drill's surface merged into it", because the dust produced no splits and the pipeline concluded "the boundaries never cross".

### Mesh fallback (`mesh/csg.rs`)

Operand polygons are split along the other operand's triangle carrier planes (AABB-localized). Fragments are classified by ray parity against the *other operand's actual mesh*, using exact predicates at two probes nudged ±normal from the fragment centroid. Split verdicts become `OnAligned` / `OnOpposed`, and a keep table picks fragments per operation. BSP leaf semantics were deliberately *not* used: "chained fallbacks feed triangle-soup results (with hairline t-junction seams) back in as operands, and leaf classification on such input misclassifies whole fragments (measured: a chained pocket-and-slot part read 32% high while every parity probe was correct)" (DOCUMENTED, https://github.com/ecto/vcad/blob/main/crates/vcad-kernel-booleans/src/mesh/csg.rs). Afterwards `QuadricCtx` re-projects vertices onto the operand quadrics. BSP splitting had left sphere vertices "up to ~0.6 mm off a R25 sphere, versus a 0.03 mm chord sag". The projection only moves a vertex if exactly one quadric claims it within a band. A vertex on one plane moves *along* that plane, and a vertex on two planes is never moved (DOCUMENTED, `api.rs` ~line 995).

### Fidelity report and gates (`api.rs`)

`Fidelity {Analytic, TriangleSoup}`. `DegradeReason` values: SteinmetzCylinders, SoupOperand ("Degradation is therefore contagious"), InvertedVolume, VolumeDisagreement, DifferenceRemovedNothing, SphereArrangement, WatertightnessSwap. `BooleanReport {op, fidelity, reason, flagged_unrepresentable, open_edges, overused_edges, faces}`. `BooleanError {Ssi(SsiError), InvalidResult(ValidityError)}`. Panics were converted to errors because a panic poisons the WASM instance (DOCUMENTED, api.rs).

After the B-rep Boolean, a chain of post-hoc gates may reject the result and re-run it on the mesh:

- Signed volume must be finite and non-negative (`validate_boolean_result`).
- `volume_disagrees_grossly` compares against a Monte-Carlo operand-implied volume.
- `union_volume_out_of_bounds`.
- `difference_removed_nothing`: a fail-closed guard against no-op cuts.
- `difference_left_tool_material`: probes for missed cuts.
- A doubled-difference trigger (open ≥ 4 and overused ≥ 3).
- `WIDE_CRACK_GAP`: hairline seams are sub-micron, bad trims are 0.3 to 1.25 mm.
- Union referee: take the mesh result if it is 20x cleaner and the volume differs by more than `max(2·(1 − sin(step)/step), 0.002)` with `step = 2π/max(segments, 8)`.
- Watertightness swap: only if the mesh result is watertight on both metrics and the volumes agree.

(All DOCUMENTED in api.rs, read lines 1-760.)

### Naming (`vcad-kernel-naming`, 801 lines)

(DOCUMENTED, https://github.com/ecto/vcad/blob/main/crates/vcad-kernel-naming/src/lib.rs and https://github.com/ecto/vcad/blob/main/docs/topo-naming-m0.md)

- Names are `scope:tag[.ordinal]*`.
- Tags are *derived from geometry*: axis-aligned plane normals give top/bottom/left/right/front/back, cylinder gives side, and so on. Repeated tags get ordinals sorted by a quantized centroid (1e-6 mm grid).
- Boolean propagation is a geometric post-pass. Each result face inherits the unique input name whose carrying surface is identical within `SURF_TOL = 1e-6`. Split siblings get `.0/.1` by quantized centroid. Two different names on one surface (flush coplanar faces from A and B) leave the face anonymous.
- An edge is the sorted pair of its adjacent face names, plus an optional `EdgeHint {midpoint, direction, length}`.
- `resolve_edge` resolves by name first. The fallback is geometric: direction within ~18° (|dot| ≥ 0.95), length ±25%, midpoint within 25% of length. The result is `Resolved{ByName|ByGeometry}`, `Ambiguous{candidates}` or `Lost{reason}`, and the last two are hard errors at every consumer.
- Why a post-pass: "the boolean pipeline computes the result→input face map and throws it away (`sew.rs::copy_faces` returns `HashMap<FaceId, FaceId>`; every call site binds it to `_`), and the boolean's enumeration order is nondeterministic".
- Ops without a propagation rule (fillet, shell, sweep, extrude) drop the map (DOCUMENTED, known limitations in topo-naming-m0.md).

### Torture corpus (`vcad-torture`)

(DOCUMENTED, https://github.com/ecto/vcad/blob/main/crates/vcad-torture/src/lib.rs, https://github.com/ecto/vcad/blob/main/docs/torture-track.md)

- Case generation: 752 cases from constants plus a splitmix64 PRNG.
- Categories:
  - coincident: cube-cube face/edge/vertex/half-face/identical, swept over `EPS_OFFSETS = [0, 1e-12, 1e-9, 1e-6, 1e-3]` × 3 ops, plus stacked cylinders.
  - tangent: sphere tangent to a cube face, inscribed cylinders, Steinmetz.
  - sliver: overlap thickness 1e-8 … 0.1.
  - chain: 3-5 step curved cut chains, seed `0xC4A1`.
  - random: 400 cases.
  - step-roundtrip: 60 cases.
  - tessellation: 85 cases.
- Execution: each case runs in its own subprocess for panic and timeout isolation (20 s).
- Classes: pass, graceful-refusal, bad-geometry, timeout, crash.
- CI: the PR subset (362 cases) fails on any per-case class regression versus `baseline.json`. Flaky cases are recorded at their *worse* class, and regressions are re-confirmed with two isolated retries.
- A second harness, `fidelity.rs`, grades representation (analytic vs soup) per (op × surface pair × configuration). It has 102 cells; 17 degrade to soup.

## Robustness and guarantees

- Arithmetic:
  - f64 throughout.
  - Shewchuk adaptive predicates (`orient2d/orient3d/incircle/insphere`, via the `tang` crate's `exact` feature wrapping `robust`) are used in point-in-polygon, coincident-plane detection and mesh ray parity (DOCUMENTED, https://github.com/ecto/vcad/blob/main/crates/vcad-kernel-math/src/predicates.rs).
  - Everything else is epsilon-based. Issue #463 counts "~45 private per-file consts ... `1e-6` appears independently in at least a dozen files" and there is no shared tolerance policy (DOCUMENTED, https://github.com/ecto/vcad/issues/463). Exact predicates are applied to *constructed* coordinates, so they certify nothing about the construction (INFERRED).
- The guarantee model is **sanity oracles, not proofs**. The key documented lesson is in `validate.rs`: two sampled validity oracles (per-probe membership and integrated predicted volume) "both false-positive on legitimate geometry ... a 3.2 mm³ thin plate reads as zero predicted volume on a 12³ grid, and a *correct* result was measured disagreeing at 4 of 216 probes while a result 32% short of the truth disagreed at 7. Sampling cannot separate those populations." They were removed. Only signed volume is kept as a sound post-hoc check, plus the up-front capability declaration (DOCUMENTED, https://github.com/ecto/vcad/blob/main/crates/vcad-kernel-booleans/src/validate.rs).
- The capability declaration itself is sampled (24 points, ±skin probes against a tessellation), so it can miss a crossing whose penetration lies between samples, for example a small drill entering a big face away from its loop vertices and edge midpoints (INFERRED from the sampling code).
- The fidelity matrix claims "0 produce a wrong solid", but issue #895 shows analytic intersections silently wrong: cone∩cylinder 16.8 mm³ vs ≈502, torus∩cylinder returning the whole torus. The issue itself says "The fidelity matrix reports representation only — '0 wrong-geometry' does not check volume" (DOCUMENTED, https://github.com/ecto/vcad/issues/895).
- The torture "pass" criterion is weak. `check_bool_result` requires watertightness and a volume within `[−slack, va + slack]` for difference with `VOL_RTOL = 0.05`, so a Difference that silently returns A unchanged passes (INFERRED from https://github.com/ecto/vcad/blob/main/crates/vcad-torture/src/lib.rs lines 822-848; the kernel-side `difference_removed_nothing` gate exists precisely because this happened in the field).
- Determinism was not achieved by design; it is being retrofitted case by case:
  - Torture baseline notes "Kernel nondeterminism (`step-bool-40`, flaky) ... `HashMap` (random-state) iteration order".
  - Issue #893: the mesh fallback gave 0 vs 12 open edges and 8118.6 vs 8150.6 mm³ depending on *environment-block size* (address/alignment-dependent) (DOCUMENTED, https://github.com/ecto/vcad/issues/893).
  - PR #903 fixed #893, merged 2026-09-17 and included in the read commit (DOCUMENTED, https://github.com/ecto/vcad/pull/903).
    - Root cause: per-process-seeded `HashMap` iteration order leaked into geometry in three places:
      - `sew::merge_nearby_vertices` and `repair::weld_boundary_vertices` removed merged vertices in `merge_map.keys()` order. The slotmap recycles freed slots LIFO, so removal order decided the keys later vertices received, and with them every id-based tie-break downstream. One 378-face union gave 4067, 4075 or 4083 triangles.
      - `tessellate::snap_boundary_rails` kept the *first* nearest open edge (strict `<`) from a hash-ordered list. A slit's two rails routinely offer exactly equidistant candidates.
      - `tessellate::heal_t_junctions_pass` built candidates from `counts.iter()`, and ties survived into `dedup_by_key` in that order.
    - Triangle counts on one part wandered between 99,985 and 105,998 across runs. In-process repeats were always bit-identical, so the bug was invisible to ordinary tests.
    - Verification: FNV hashes of all 7 fallback stages compared across 5 processes, with the environment block padded 37→370 bytes under `env -i`.
    - Lesson for wonky (INFERRED): in a slot-recycling arena, *removal order is an input*. Bend's affine arrays avoid slot reuse, but any sort, dedup or tie-break must use a total key built from geometry or identity, never container order.
  - Issue #892: union was operand-order dependent (DOCUMENTED, https://github.com/ecto/vcad/issues/892). PR #901 fixed it (DOCUMENTED, https://github.com/ecto/vcad/pull/901) and names three defects that are typical for coplanar-cap unions of prismatic parts:
    1. **One-sided coincidence.** A small cap patch inside a large coplanar cap read `OnSame`, but the large cap read `Outside` against the patch. With the small solid as operand A both copies survived: `ring ∪ post` = 4946.55 (exact) but `post ∪ ring` = 4951.99 with 30 open edges. The fix is a new `FaceClassification::OnSameInner` where the larger face wins. "Larger" is decided by boundary probes pulled 5% inward, not by area: a sheet-metal bend end face is 1.3% larger than the flange face it sits on, and an area-only test dropped it.
    2. **Phantom full-width chords.** Every post's side plane handed the ring's cap a chord across the whole face, although a post reaches only 0.5 mm into a 4.75 mm wall. Twelve posts gave −9.3% volume and 429 open edges. The fix skips a planar `Line` split when the cutter face ends flush on that plane *and* the other solid has a coplanar, same-facing, contained face there. Both extra conditions are load-bearing (boss-on-plate, flange-over-plate counterexamples).
    3. **Wrong span.** `split_planar_face` used `crossings[0..2]` for every segment of a line. On a notched face the line crosses in three spans, and the first span was cut three times.

    Result on the 50-stage rana-60 stator: 7853.0 mm³ vs a 7848 mm³ reference, **Analytic**, 11,709 triangles in 24 s. Before: 7830.6 mm³, TriangleSoup, 104,725 triangles in 59 s.
  - Draft PR #904 (open, https://github.com/ecto/vcad/pull/904) targets #894: chained mesh Booleans never re-merge coplanar fragments.
    - It adds a fail-closed `merge_coplanar_regions`: flood fill, boundary loops, 2D earcut with holes, per-region guards on signed area, unpaired edges and use counts.
    - A 12-step chain drops from 6,146 to 2,740 triangles.
    - The 50-step fold still does not finish (2.7-4.5 GB). The guards reject 38 of 49 regions. The author calls `MERGE_MIN_REGION_TRIS = 64` "calibration, not principle".

## Parallelism and performance

- Rayon `par_iter` over SSI candidate pairs only. Everything else is sequential, with mutable arena topology (slotmap keys, fresh `BRepSolid` per stage) (DOCUMENTED, `pipeline.rs`, topo-naming-m0.md).
- Full torture corpus: "~1–2 s wall on a laptop after the build" (DOCUMENTED, torture-track.md).
- Real parts are slow and non-monotonic:
  - Plate cost vs corner radius: r=16 23.8 s, r=20 5.2 s, r=25 68.3 s.
  - A face-coincident union of plates: >400 s vs its mirror at 10 s (DOCUMENTED, https://github.com/ecto/vcad/issues/831).
  - "Difference chains of ~40 extruded tools don't finish (rotor/stator export > 25 min on main)" (https://github.com/ecto/vcad/issues/879).
  - Naming propagation over a soup operand was "~100% of a chained boolean's cost (the rana-60 stator: 40+ minutes)" until it was rewritten to surface classes (DOCUMENTED, naming lib.rs comment).
  - A soup-operand chain once produced 246k triangles in 21 s (DOCUMENTED, api.rs).
- GPU: a `kernel-gpu` crate exists with wavefront tests failing on Apple silicon (https://github.com/ecto/vcad/issues/897). It is not part of the Boolean path (INFERRED; not read).

## Known failures, limitations, war stories

All DOCUMENTED with the URL given:

- Silent wrong solids are the dominant failure class. From api.rs and validate.rs comments:
  - "Every failure in the 2026-08-11 hemispherical-socket handoff was *silent*: the pipeline returned a closed, plausible-looking mesh of the wrong solid."
  - A torr catalogue blade cut lost 529 mm³ when swapped to soup.
  - A shell-ring reproducer's analytic mesh read 89 cm³ vs a true 43 cm³.
  - A stator union came back with 1309/1358 open edges.
  - A printed rotor's shaft bore came back solid because of overused edges.
- Degradation is contagious: once an operand is soup, every later Boolean is soup. The STEP export then falls back to tessellated faces, "unusable for CNC" (https://github.com/ecto/vcad/issues/872). A batched-boolean STEP was not watertight, "1267/2641 edges used once" (https://github.com/ecto/vcad/issues/880).
- Chained mesh Booleans re-split coplanar caps without bound (https://github.com/ecto/vcad/issues/894). Tangent fillet rims leave ~100-180 unpaired edges (https://github.com/ecto/vcad/issues/902). Sheet-metal fold union leaves 64 open edges (+3.4 mm³) (https://github.com/ecto/vcad/issues/896).
- Torture scoreboard:
  - 2026-07-17 doc table: 576/752 pass (76.6%), boolean-chain 0/24, every failure bad-geometry and "one root cause": seam T-junctions on trimmed curved faces.
  - Current `baseline.json`: 684 pass / 68 bad-geometry (91.0%), chain 14/24, random 361/400 (DOCUMENTED, https://github.com/ecto/vcad/blob/main/crates/vcad-torture/baseline.json).
  - The first run found 12 crashes from a one-sample SSI curve underflowing `len - 2` (fixed).
- Torus tessellation had no arm in `tessellate_brep`. The pipeline "leaves torus faces untrimmed and currently relies on them being dropped" (torture-track.md).
- Two classic sign bugs are preserved as doc comments:
  - Double flip in `sew.rs`: loop reversal plus orientation flip cancelled, so hole walls added volume (29088 vs 27936).
  - `trim.rs` sampled a plane-plane SSI line around an origin far from the face and missed it entirely.

## Relevance for wonky

vcad is the closest living analogue to wonky's leading bake-off hybrid (tagged mesh Boolean plus analytic recovery), and it is a detailed record of what goes wrong in exactly that design when tolerances are f64 epsilons and validation is sampled. Mapping to wonky's constraints:

- **Bend fit**: The mutable slotmap arenas, `HashMap`-order-dependent decisions and rayon-only-on-SSI structure do not port. The *algorithms* do port, and are mostly map/filter/sort shaped: lattice sampling, v-band chains, ray-parity classification with on-boundary verdicts, the keep table, the fidelity/degrade-reason record, and naming as a pure post-pass keyed by surface identity (INFERRED).
- **Precision**: vcad's failures cluster exactly where wonky plans exact multi-limb U32 predicates. Ray parity on a mesh, coplanar detection and on-boundary classification all become exact if the mesh coordinates are exactly representable (F32 grid) and the predicates are multi-limb. What stays approximate in wonky is the same thing vcad struggles with: the recovery from mesh to analytic surface. vcad's `QuadricCtx` rules are a ready-made spec for that step, with explicit bands (INFERRED).
- **Failure-as-data**: `Fidelity` + `DegradeReason` + `BooleanReport` + `BooleanError`, and naming's `Resolved | Ambiguous | Lost`, are the pattern wonky's "unsupported cases must fail explicitly" rule wants. wonky should go further than vcad and make the fidelity level part of the result *type*, so a soup result cannot flow into STEP export or naming without being handled (INFERRED).
- **Test corpus**: the splitmix64 corpus design (EPS offset ladders `[0, 1e-12, 1e-9, 1e-6, 1e-3]`, thickness ladders, seeded chains, subprocess isolation, worse-class baseline, per-case regression gate) is directly reusable as a *specification*: port the case generators and grading classes, not the code. wonky's grading must be stronger. Require exact or closed-form volume where available (issue #895's lesson: "assert volume against a closed form in any new test"), and check that a difference changed something.
- **Licensing**: Apache-2.0 per LICENSE (MIT per Cargo.toml). Reimplement from the description only; the ideas are generic.

## Pointers worth porting or studying

1. `split.rs::canonical_arc_points` + `freeze.rs`: canonical per-circle angular lattice with sign-canonicalized normal and world-axis-derived x axis, applied to *both* operands before the Boolean. Combine with Fornjot's identical idea. In wonky, lattice angles must be computed so that both faces get bit-identical F32 coordinates (compute from `(circle id, k)`, never from neighbors).
2. `cyl_band.rs`: v-band faces with independent chains sliced verbatim. This is a general rule for conforming seams: never resample a shared boundary, only insert exact cut points.
3. `unrepresentable.rs`: declare capability *before* running. wonky should replace the sampled crossing test with an exact or interval test (the sampled one can miss penetrations), but keep the shape: `pair_is_analytic` table plus a genuine-crossing check, routed to an explicit fallback or an explicit error.
4. `mesh/csg.rs` keep table with `OnAligned` / `OnOpposed` from two-sided probes, and the reason ray parity beat BSP leaves on cracked chained input.
5. `validate.rs` negative result: sampled oracles cannot separate thin legitimate geometry from wrong solids. wonky should not build a sampled validator; it needs signed volume plus exact topological checks (every edge used exactly twice, consistent orientation).
6. `api.rs` `QuadricCtx::project_mesh` conservativeness rules (single claiming quadric, project along a plane, never move a vertex on two planes) as the recovery spec for the tagged-mesh hybrid.
7. `vcad-kernel-naming`: geometry-derived seeds, surface-identity propagation, sibling ordinals, face-pair edge refs, fail-closed resolution. Caveat (INFERRED): quantized-centroid ordinals are unstable when a sibling appears or disappears or when a centroid crosses a quantum boundary. wonky's tagged mesh already carries source-face tags, so it can propagate provenance *through* the Boolean instead of re-deriving it (vcad discarded its `copy_faces` map).
8. Contrast with hypermesh (`sources/hypermesh-hyperreal-hyper-stack-under-csgrs.md`). It keeps the provenance vcad throws away: `TriangleSource{mesh, triangle, orientation}` per output triangle, plus construction identities (`SourceEdgePlane`, `PlaneTriple`) per vertex. Its box-volume fuzz oracle is exact where vcad's `VOL_RTOL = 0.05` grading is not.
9. `vcad-torture` generators and grading classes; `fidelity.rs` representation matrix; the stage-hash method from #893/#903 for hunting nondeterminism (FNV-hash every stage's output, compare across processes, run under `env -i` with a padded environment block).
10. PR #901's `classify.rs` `OnSameInner` and the flush-chord suppression rule in `pipeline.rs`. Take them as *test cases*, not as algorithms: ring ∪ post in both operand orders, 12 posts at 30°, a boss on a plate, a flange over a plate, a notched face crossed in three spans. In wonky's exact tagged-mesh stage these cases are decided by exact coplanarity and winding, so they should pass without special rules. They are exactly the cases a heuristic analytic Boolean gets wrong (INFERRED).

## Verdict: learn-from

Do not adopt code (license mismatch, f64/epsilon architecture, mutable arenas, nondeterminism). Take the design lessons, which are unusually well documented and measured, as specifications for wonky:

- The fidelity/degrade report.
- Up-front capability declaration.
- The canonical lattice with frozen circles.
- The verbatim-chain rule.
- Ray-parity keep table.
- The rejection of sampled oracles.
- Conservative quadric re-projection.
- Fail-closed naming.
- A splitmix64 torture corpus with regression gating and stronger grading.
